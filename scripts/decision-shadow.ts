import "dotenv/config";
import { prisma } from "../src/lib/db";
import { decisionRetryState } from "../src/lib/decision/backfill";
import { buildSourceConsistencyRequest } from "../src/lib/decision/consistency";
import { JevDecisionProvider } from "../src/lib/decision/jev";
import { buildPolicyIntelligenceRequest } from "../src/lib/decision/policy-intelligence";
import { runShadowDecision } from "../src/lib/decision/shadow";
import { buildViewChangeRequest, type ComparableAtomicView } from "../src/lib/decision/view-change";
import type { DecisionRequest } from "../src/lib/decision/types";
import type { ParsedPolicyDocument } from "../src/lib/macro/policy/types";

const mode = process.argv[2] ?? "consistency";
const limitArg = process.argv.find((value) => value.startsWith("--limit="))?.slice(8);
const limit = Math.max(1, Number(limitArg || 50));

async function eligible(request: DecisionRequest): Promise<boolean> {
  const fingerprint = request.audit?.requestFingerprint;
  if (!fingerprint) return true;
  const attempts = await prisma.decisionCall.findMany({
    where: { requestFingerprint: fingerprint, decisionType: request.decisionType },
    select: { ok: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return decisionRetryState(attempts).status === "READY";
}

async function execute(requests: DecisionRequest[]) {
  const provider = new JevDecisionProvider();
  let recorded = 0, failed = 0, skipped = 0;
  for (const request of requests.slice(0, limit)) {
    if (!(await eligible(request))) { skipped++; continue; }
    const result = await runShadowDecision(provider, request);
    if (result.status === "RECORDED") recorded++;
    else if (result.status === "FAILED") failed++;
    else skipped++;
  }
  console.log(JSON.stringify({ event: "decision.shadow.complete", mode, candidates: requests.length, recorded, failed, skipped }));
}

async function consistencyRequests(): Promise<DecisionRequest[]> {
  const rows = await prisma.analysis.findMany({
    where: { article: { rawText: { not: null } } },
    include: { article: { include: { atomicViews: { orderBy: { position: "asc" } } } } },
    orderBy: { updatedAt: "desc" },
    take: limit * 2,
  });
  return rows.flatMap((row) => row.article.rawText ? [buildSourceConsistencyRequest({
    contentId: row.articleId,
    source: { title: row.article.title, text: row.article.rawText, contentHash: row.article.contentHash },
    generated: {
      summary: row.summary,
      keyArguments: JSON.parse(row.keyArguments),
      keyNumbers: JSON.parse(row.keyNumbers),
      interpretation: row.interpretation,
      atomicViews: row.article.atomicViews.map((view) => ({ view: view.viewEn, sourceQuote: view.sourceQuote, direction: view.direction })),
    },
  })] : []);
}

function parsedPolicy(value: string | null): ParsedPolicyDocument | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ParsedPolicyDocument;
    return parsed && typeof parsed === "object" && typeof parsed.decision === "string" ? parsed : null;
  } catch { return null; }
}

async function policyRequests(): Promise<DecisionRequest[]> {
  const rows = await prisma.macroPolicyDocument.findMany({
    where: { parsedJson: { not: null } },
    orderBy: [{ centralBank: "asc" }, { publishedAt: "asc" }],
  });
  const previous = new Map<string, typeof rows[number]>();
  const requests: DecisionRequest[] = [];
  for (const row of rows) {
    const parsed = parsedPolicy(row.parsedJson);
    if (!parsed) continue;
    const prior = previous.get(row.centralBank);
    const priorParsed = parsedPolicy(prior?.parsedJson ?? null);
    requests.push(buildPolicyIntelligenceRequest({
      contentId: row.id,
      centralBank: row.centralBank,
      current: { id: row.id, contentHash: row.contentHash, publishedAt: row.publishedAt.toISOString(), parsed },
      previous: prior && priorParsed ? { id: prior.id, contentHash: prior.contentHash, publishedAt: prior.publishedAt.toISOString(), parsed: priorParsed } : null,
    }));
    previous.set(row.centralBank, row);
  }
  return requests.reverse();
}

async function viewRequests(): Promise<DecisionRequest[]> {
  const rows = await prisma.atomicView.findMany({
    include: { article: { select: { institutionId: true, publishedAt: true, classification: { select: { jurisdictions: true } } } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(500, limit * 20),
  });
  const perArticle = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const jurisdiction = row.article.classification?.jurisdictions.find((item) => item.role === "PRIMARY")?.jurisdictionKey ?? "UNKNOWN";
    const key = `${row.article.institutionId}|${jurisdiction}|${row.topic}|${row.articleId}`;
    const current = perArticle.get(key);
    if (!current || row.importance > current.importance) perArticle.set(key, row);
  }
  const groups = new Map<string, Array<typeof rows[number]>>();
  for (const row of perArticle.values()) {
    const jurisdiction = row.article.classification?.jurisdictions.find((item) => item.role === "PRIMARY")?.jurisdictionKey ?? "UNKNOWN";
    const key = `${row.article.institutionId}|${jurisdiction}|${row.topic}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const requests: DecisionRequest[] = [];
  const comparable = (row: typeof rows[number]): ComparableAtomicView => ({
    id: row.id, articleId: row.articleId, publishedAt: row.article.publishedAt.toISOString(), view: row.viewEn,
    direction: row.direction, type: row.type, value: row.value, timeHorizon: row.timeHorizon, sourceQuote: row.sourceQuote,
  });
  for (const [key, group] of groups) {
    group.sort((a, b) => a.article.publishedAt.getTime() - b.article.publishedAt.getTime());
    for (let index = 1; index < group.length; index++) {
      const [institutionId, jurisdiction, topic] = key.split("|");
      const current = group[index];
      requests.push(buildViewChangeRequest({
        contentId: current.articleId, institutionId, jurisdiction, topic,
        previous: comparable(group[index - 1]), current: comparable(current),
      }));
    }
  }
  return requests.reverse();
}

async function main() {
  if (!process.env.JEV_DECISION_ENABLED || process.env.JEV_DECISION_ENABLED.toLowerCase() !== "true") {
    console.log("JEV decision shadow is disabled; set JEV_DECISION_ENABLED=true to run this opt-in job.");
    return;
  }
  if (mode === "consistency") return execute(await consistencyRequests());
  if (mode === "policy") return execute(await policyRequests());
  if (mode === "views") return execute(await viewRequests());
  throw new Error("Mode must be consistency, policy, or views.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
