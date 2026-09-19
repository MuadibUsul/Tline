import "dotenv/config";
import { prisma } from "../src/lib/db";
import { classifyDeterministically, DETERMINISTIC_CLASSIFIER_VERSION } from "../src/lib/classification/classifier";
import { taxonomy } from "../src/lib/classification/taxonomy";
import type { ClassificationResult, ClassificationSource, ContentType, DecisionState } from "../src/lib/classification/types";
import { decisionFingerprint, decisionRetryState, summarizeShadowComparisons } from "../src/lib/decision/backfill";
import { buildClassificationShadowRequest, classificationDecisionPatch } from "../src/lib/decision/classification";
import { JevDecisionProvider } from "../src/lib/decision/jev";
import { runShadowDecision } from "../src/lib/decision/shadow";
import { buildTaskContext } from "../src/lib/llm/context-builder";

const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const integer = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(arg(name) ?? process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const apply = flag("apply");
const persistDecisions = flag("persist-decisions");
const reportOnly = flag("report");
const limit = integer("limit", 20, 1, 500);
const excerptChars = integer("JEV_CLASSIFICATION_EXCERPT_CHARS", 6_000, 500, 50_000);
const minIntervalMs = integer("JEV_MIN_INTERVAL_MS", 1_000, 0, 60_000);
const maxFailures = integer("JEV_MAX_FAILURES", 3, 1, 10);
const retryBaseMs = integer("JEV_RETRY_BASE_MS", 60_000, 0, 86_400_000);
const retryMaxMs = integer("JEV_RETRY_MAX_MS", 3_600_000, retryBaseMs, 604_800_000);

function fromStored(classification: {
  jurisdictionState: string;
  contentType: string;
  confidence: number;
  source: string;
  jurisdictions: Array<{ jurisdictionKey: string; role: string }>;
  institutions: Array<{ institutionKey: string; role: string; confidence: number | null }>;
  topics: Array<{ topicKey: string; confidence: number }>;
  assets: Array<{ confidence: number; asset: { ticker: string } }>;
  assetClasses: Array<{ assetClassKey: string; confidence: number }>;
  events: Array<{ eventKey: string; confidence: number }>;
}): ClassificationResult {
  return {
    jurisdictionState: classification.jurisdictionState as DecisionState,
    primaryJurisdiction: (classification.jurisdictions.find((item) => item.role === "PRIMARY")?.jurisdictionKey ?? null) as ClassificationResult["primaryJurisdiction"],
    relatedJurisdictions: classification.jurisdictions.filter((item) => item.role !== "PRIMARY").map((item) => item.jurisdictionKey) as ClassificationResult["relatedJurisdictions"],
    institutions: classification.institutions.map((item) => ({ key: item.institutionKey, role: item.role, confidence: item.confidence ?? undefined })) as ClassificationResult["institutions"],
    topics: classification.topics.map((item) => ({ key: item.topicKey, confidence: item.confidence })) as ClassificationResult["topics"],
    assets: classification.assets.map((item) => ({ key: item.asset.ticker, confidence: item.confidence })),
    assetClasses: classification.assetClasses.map((item) => ({ key: item.assetClassKey, confidence: item.confidence })) as ClassificationResult["assetClasses"],
    events: classification.events.map((item) => ({ key: item.eventKey, confidence: item.confidence })) as ClassificationResult["events"],
    contentType: classification.contentType as ContentType,
    confidence: classification.confidence,
    source: classification.source as ClassificationSource,
  };
}

async function createDeterministicClassification(article: {
  id: string;
  contentHash: string;
  articleAssets: Array<{ assetId: string; asset: { ticker: string } }>;
}) {
  const result = classifyDeterministically({
    assets: article.articleAssets.map((item) => item.asset.ticker),
    contentType: "RESEARCH_ARTICLE",
  });
  const assetIds = new Map(article.articleAssets.map((item) => [item.asset.ticker, item.assetId]));
  const classification = await prisma.contentClassification.create({
    data: {
      contentKind: "ARTICLE",
      articleId: article.id,
      jurisdictionState: result.jurisdictionState,
      contentType: result.contentType,
      confidence: result.confidence,
      source: result.source,
      status: "PENDING",
      classifier: "deterministic",
      classifierVersion: DETERMINISTIC_CLASSIFIER_VERSION,
      taxonomyVersion: taxonomy.version,
      fingerprint: article.contentHash,
      classifiedAt: new Date(),
      jurisdictions: { create: [
        ...(result.primaryJurisdiction ? [{ jurisdictionKey: result.primaryJurisdiction, role: "PRIMARY" }] : []),
        ...result.relatedJurisdictions.map((jurisdictionKey) => ({ jurisdictionKey, role: "RELATED" })),
      ] },
      institutions: { create: result.institutions.map((item) => ({ institutionKey: item.key, role: item.role, confidence: item.confidence })) },
      topics: { create: result.topics.map((item) => ({ topicKey: item.key, confidence: item.confidence })) },
      assets: { create: result.assets.flatMap((item) => assetIds.has(item.key) ? [{ assetId: assetIds.get(item.key)!, confidence: item.confidence }] : []) },
      assetClasses: { create: result.assetClasses.map((item) => ({ assetClassKey: item.key, confidence: item.confidence })) },
      events: { create: result.events.map((item) => ({ eventKey: item.key, confidence: item.confidence })) },
    },
  });
  return { id: classification.id, result };
}

async function report() {
  const rows = await prisma.decisionCall.findMany({
    where: { provider: "jev", decisionType: "content.classification.shadow", shadowMode: true },
    orderBy: { createdAt: "desc" },
    take: integer("report-limit", 1_000, 1, 10_000),
    select: { ok: true, selectedValue: true, baselineValue: true },
  });
  console.log(JSON.stringify({ event: "classification.shadow.report", ...summarizeShadowComparisons(rows) }));
}

async function main() {
  if (reportOnly) return report();
  if (apply && process.env.JEV_DECISION_ENABLED?.trim().toLowerCase() !== "true") {
    throw new Error("JEV_DECISION_ENABLED=true is required with --apply.");
  }
  if (persistDecisions && (!apply || process.env.JEV_CLASSIFICATION_APPLY_ENABLED?.trim().toLowerCase() !== "true")) {
    throw new Error("--persist-decisions requires --apply and JEV_CLASSIFICATION_APPLY_ENABLED=true.");
  }

  const provider = new JevDecisionProvider();
  const metrics = { scanned: 0, planned: 0, called: 0, succeeded: 0, failed: 0, complete: 0, waiting: 0, exhausted: 0, manual: 0 };
  let offset = 0;
  let lastStartedAt = 0;

  while (metrics.planned < limit) {
    const articles = await prisma.article.findMany({
      where: { rawText: { not: null } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: 100,
      include: {
        articleAssets: { include: { asset: { select: { ticker: true } } } },
        classification: { include: { jurisdictions: true, institutions: true, topics: true, assets: { include: { asset: { select: { ticker: true } } } }, assetClasses: true, events: true } },
      },
    });
    if (!articles.length) break;
    offset += articles.length;

    for (const article of articles) {
      if (metrics.planned >= limit) break;
      metrics.scanned += 1;
      if (article.classification?.source === "MANUAL") { metrics.manual += 1; continue; }

      const stored = article.classification
        ? { id: article.classification.id, result: fromStored(article.classification) }
        : apply
          ? await createDeterministicClassification(article)
          : { id: undefined, result: classifyDeterministically({ assets: article.articleAssets.map((item) => item.asset.ticker), contentType: "RESEARCH_ARTICLE" }) };
      const classificationContext = buildTaskContext("classification", { title: article.title, text: article.rawText! }, {
        preferredInputTokens: Math.max(125, Math.ceil(excerptChars / 4)),
        maxInputTokens: Math.max(125, Math.ceil(excerptChars / 4)),
        fullTextAllowed: false,
      });
      const request = buildClassificationShadowRequest({
        document: { title: article.title, excerpt: classificationContext.selectedText },
        deterministic: stored.result,
        classificationId: stored.id,
      });
      if (!request) { metrics.complete += 1; continue; }

      const fingerprint = decisionFingerprint({
        contentHash: `${article.contentHash}:${article.titleHash}`,
        taxonomyVersion: taxonomy.version,
        provider: provider.name,
        model: provider.model,
        questionIds: Object.keys(request.questions),
      });
      request.audit = { ...request.audit, requestFingerprint: fingerprint };
      const attempts = await prisma.decisionCall.findMany({
        // The response may report a resolved model revision instead of the requested alias.
        // The requested model is already part of the fingerprint, so filtering on the
        // recorded response model would miss a completed call and bill it twice.
        where: { provider: provider.name, decisionType: request.decisionType, requestFingerprint: fingerprint },
        select: { ok: true, createdAt: true },
      });
      const retry = decisionRetryState(attempts, new Date(), { maxFailures, baseDelayMs: retryBaseMs, maxDelayMs: retryMaxMs });
      if (retry.status === "COMPLETE") { metrics.complete += 1; continue; }
      if (retry.status === "WAIT") { metrics.waiting += 1; continue; }
      if (retry.status === "EXHAUSTED") { metrics.exhausted += 1; continue; }

      metrics.planned += 1;
      if (!apply) continue;
      const delay = Math.max(0, minIntervalMs - (Date.now() - lastStartedAt));
      if (delay) await pause(delay);
      lastStartedAt = Date.now();
      metrics.called += 1;
      const outcome = await runShadowDecision(provider, request, { enabled: true, shadowMode: true });
      if (outcome.status === "RECORDED") {
        metrics.succeeded += 1;
        if (persistDecisions && stored.id) {
          const patch = classificationDecisionPatch(outcome.result, {
            reviewThreshold: Number(process.env.JEV_CLASSIFICATION_REVIEW_THRESHOLD ?? 0.65),
            autoThreshold: Number(process.env.JEV_CLASSIFICATION_AUTO_THRESHOLD ?? 0.9),
          });
          const current = await prisma.contentClassification.findUnique({ where: { id: stored.id }, select: { source: true } });
          if (current && current.source !== "MANUAL") {
            await prisma.$transaction(async (tx) => {
              await tx.contentClassification.update({
                where: { id: stored.id },
                data: {
                  ...(patch.contentType ? { contentType: patch.contentType } : {}),
                  ...(patch.jurisdiction ? { jurisdictionState: patch.jurisdiction.state } : {}),
                  confidence: Math.max(stored.result.confidence, patch.confidence),
                  source: patch.accepted ? (stored.result.source === "DETERMINISTIC" ? "MIXED" : "JEV") : stored.result.source,
                  status: patch.status,
                  classifier: "deterministic+jev", classifierVersion: `${DETERMINISTIC_CLASSIFIER_VERSION}+${provider.model}`,
                  classifiedAt: new Date(),
                },
              });
              if (patch.jurisdiction) {
                await tx.classificationJurisdiction.deleteMany({ where: { classificationId: stored.id } });
                if (patch.jurisdiction.primary) await tx.classificationJurisdiction.create({ data: { classificationId: stored.id, jurisdictionKey: patch.jurisdiction.primary, role: "PRIMARY" } });
              }
              if (patch.primaryTopic) {
                await tx.classificationTopic.upsert({
                  where: { classificationId_topicKey: { classificationId: stored.id, topicKey: patch.primaryTopic.key } },
                  create: { classificationId: stored.id, topicKey: patch.primaryTopic.key, confidence: patch.primaryTopic.confidence },
                  update: { confidence: patch.primaryTopic.confidence },
                });
              }
            });
          }
        }
      }
      else metrics.failed += 1;
    }
  }

  console.log(JSON.stringify({ event: apply ? "classification.shadow.backfill" : "classification.shadow.preview", metrics }));
  await report();
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "classification.shadow.failed", error: String(error).slice(0, 500) }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
