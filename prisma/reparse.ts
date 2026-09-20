import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { ANALYSIS_PROMPT_VERSION, parseArticle } from "../src/lib/ingest/parseLLM";
import { syncForecastsForArticle } from "../src/lib/forecast";
import { MAX_FAILURES, clearFailures, dueFilter, recordFailure } from "../src/lib/articleBackoff";
import { anyProviderConfigured } from "../src/lib/llm/config";
import { queueRetry } from "../src/lib/contentRetry";
import { classifyDeterministically } from "../src/lib/classification/classifier";
import { discoverArticleClassification } from "../src/lib/classification/discovery";
import { articleClassificationSourceFingerprint, persistDeterministicClassification } from "../src/lib/classification/store";

const flag = (name: string) => process.argv.includes(`--${name}`);
const articleIds = (process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6) || process.argv.find((arg) => arg.startsWith("--id="))?.slice(5) || "").split(",").filter(Boolean);
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 1) : undefined;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.min(8, Math.max(1, Number(concurrencyArg?.split("=")[1] || process.env.REPARSE_CONCURRENCY || 3)));

async function main() {
  if (!(await anyProviderConfigured()) && !flag("heuristic")) {
    console.log("No model provider is configured. Add one in the console (Platform -> Model providers), set a provider API key in the environment, or pass --heuristic.");
    return;
  }

  const all = flag("all");
  const retryReview = flag("retry-review");
  /**
   * Whether the pass also reconsiders analyses an older prompt wrote.
   *
   * Off by default and never implied by another flag. Re-running the corpus is a model bill
   * and it has to be a decision, not a side effect of a deployment — the same reason the
   * translation backlog is behind its own switch.
   *
   * Without it, `promptVersion` is written and never read: the selection above asks only for
   * "no analysis yet", so every article that already has a row is unreachable by any later
   * improvement to the prompt. That is how `seo_title_en` — asked for by the current version,
   * read back by the parser, written by this script — ended up populated on none of the
   * corpus, leaving every page titled with the publisher's series name.
   */
  const stalePrompt = flag("stale-prompt") || /^(?:1|true|yes)$/i.test(process.env.REPARSE_STALE_PROMPT ?? "");
  // An operator who named ids, or asked for everything, gets what they asked for; backoff
  // only governs the automatic pass the scheduler runs every minute.
  const operatorSelected = articleIds.length > 0 || all;
  const selection: Prisma.ArticleWhereInput[] = [];
  if (!all) {
    const revisit: Prisma.ArticleWhereInput[] = [{ analysis: { is: null } }];
    if (retryReview) revisit.push({ analysis: { reviewStatus: "needs_review" } });
    if (stalePrompt) revisit.push({ analysis: { promptVersion: { not: ANALYSIS_PROMPT_VERSION } } });
    selection.push(revisit.length === 1 ? revisit[0] : { OR: revisit });
  }
  if (!operatorSelected) selection.push(dueFilter("analysis"));
  // Selected in the database rather than loaded and filtered here: the previous version
  // pulled every article's full body into memory on every pass to keep fifty of them.
  const candidates = await prisma.article.findMany({
    where: {
      rawText: { not: null },
      ...(articleIds.length ? { id: { in: articleIds } } : {}),
      ...(selection.length ? { AND: selection } : {}),
    },
    select: {
      id: true,
      title: true,
      contentHash: true,
      titleHash: true,
      rawText: true,
      publishedAt: true,
      institution: { select: { name: true } },
      segments: { select: { heading: true, text: true }, orderBy: { position: "asc" } },
      analysis: { select: { reviewStatus: true } },
      classification: { select: {
        jurisdictionState: true, contentType: true,
        jurisdictions: { select: { jurisdictionKey: true } },
        institutions: { select: { institutionKey: true } },
        topics: { select: { topicKey: true } },
        assets: { select: { asset: { select: { ticker: true } } } },
        assetClasses: { select: { assetClassKey: true } },
        events: { select: { eventKey: true } },
      } },
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  const assets = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  const assetIds = new Map(assets.map((asset) => [asset.ticker, asset.id]));

  let updated = 0;
  let unresolved = 0;
  let failed = 0;

  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    await Promise.all(candidates.slice(offset, offset + concurrency).map(async (article) => {
      try {
      const parsed = await parseArticle({
        contentId: article.id,
        contentHash: article.contentHash,
        institution: article.institution.name,
        title: article.title,
        text: article.rawText!,
        publishedAt: article.publishedAt.toISOString(),
        classification: article.classification ? {
          jurisdictionState: article.classification.jurisdictionState,
          jurisdictions: article.classification.jurisdictions.map((item) => item.jurisdictionKey),
          institutions: article.classification.institutions.map((item) => item.institutionKey),
          topics: article.classification.topics.map((item) => item.topicKey),
          assets: article.classification.assets.map((item) => item.asset.ticker),
          assetClasses: article.classification.assetClasses.map((item) => item.assetClassKey),
          events: article.classification.events.map((item) => item.eventKey),
          contentType: article.classification.contentType,
        } : null,
      }, article.segments);

      if (parsed.needsLLM) {
        unresolved++;
      }

      const uniqueSignals = [...new Map(
        parsed.assets
          .filter((signal) => assetIds.has(signal.ticker))
          .map((signal) => [signal.ticker, signal]),
      ).values()];

      await prisma.$transaction(async (tx) => {
        const claimed = await tx.article.updateMany({
          where: { id: article.id, contentHash: article.contentHash },
          data: { contentHash: article.contentHash },
        });
        if (claimed.count !== 1) throw new Error("Article changed while analysis was running; stale result discarded.");
        await Promise.all([
        tx.analysis.upsert({
          where: { articleId: article.id },
          create: {
            articleId: article.id,
            summary: parsed.summary,
            seoTitle: parsed.seoTitle,
            summaryZh: parsed.summaryZh,
            keyArguments: JSON.stringify(parsed.keyArguments),
            keyArgumentsZh: JSON.stringify(parsed.keyArgumentsZh),
            keyNumbers: JSON.stringify(parsed.keyNumbers),
            keyNumbersZh: JSON.stringify(parsed.keyNumbersZh),
            risks: JSON.stringify(parsed.risks),
            risksZh: JSON.stringify(parsed.risksZh),
            interpretation: parsed.interpretation,
            interpretationZh: parsed.interpretationZh,
            importanceScore: parsed.importanceScore,
            confidence: parsed.confidence,
            provider: parsed.provider,
            model: parsed.model,
            promptVersion: parsed.promptVersion,
            reviewStatus: parsed.reviewStatus,
            sourceContentHash: article.contentHash,
          },
          update: {
            summary: parsed.summary,
            seoTitle: parsed.seoTitle,
            summaryZh: parsed.summaryZh,
            keyArguments: JSON.stringify(parsed.keyArguments),
            keyArgumentsZh: JSON.stringify(parsed.keyArgumentsZh),
            keyNumbers: JSON.stringify(parsed.keyNumbers),
            keyNumbersZh: JSON.stringify(parsed.keyNumbersZh),
            risks: JSON.stringify(parsed.risks),
            risksZh: JSON.stringify(parsed.risksZh),
            interpretation: parsed.interpretation,
            interpretationZh: parsed.interpretationZh,
            importanceScore: parsed.importanceScore,
            confidence: parsed.confidence,
            provider: parsed.provider,
            model: parsed.model,
            promptVersion: parsed.promptVersion,
            reviewStatus: parsed.reviewStatus,
            sourceContentHash: article.contentHash,
          },
        }),
        tx.articleAsset.deleteMany({ where: { articleId: article.id } }),
        tx.atomicView.deleteMany({ where: { articleId: article.id } }),
        ...uniqueSignals.map((signal) => tx.articleAsset.create({
          data: {
            articleId: article.id,
            assetId: assetIds.get(signal.ticker)!,
            direction: signal.direction,
            target: signal.target ?? null,
            previousTarget: signal.previousTarget ?? null,
            timeHorizon: signal.timeHorizon ?? null,
            confidence: signal.confidence,
          },
        })),
        ...parsed.atomicViews.map((view, position) => tx.atomicView.create({
          data: {
            articleId: article.id,
            position,
            viewEn: view.viewEn,
            viewZh: view.viewZh,
            type: view.type,
            asset: view.asset,
            assetTicker: view.assetTicker,
            topic: view.topic,
            direction: view.direction,
            timeHorizon: view.timeHorizon,
            value: view.value,
            conditionEn: view.conditionEn,
            conditionZh: view.conditionZh,
            rationaleEn: view.rationaleEn,
            rationaleZh: view.rationaleZh,
            confidence: view.confidence,
            importance: view.importance,
            sourceQuote: view.sourceQuote,
            provider: parsed.provider,
            model: parsed.model,
            promptVersion: parsed.promptVersion,
            reviewStatus: parsed.reviewStatus,
          },
        })),
        ]);
      }, { isolationLevel: "Serializable" });
      await persistDeterministicClassification({
        target: { kind: "ARTICLE", id: article.id },
        result: classifyDeterministically(discoverArticleClassification({
          title: article.title,
          text: article.rawText!,
          assetTickers: uniqueSignals.map((signal) => signal.ticker),
        })),
        sourceFingerprint: articleClassificationSourceFingerprint(article.contentHash, article.titleHash, uniqueSignals.map((signal) => signal.ticker)),
        apply: true,
      }).catch((error) => console.error(JSON.stringify({ event: "classification.analysis.failed", articleId: article.id, error: String(error).slice(0, 300) })));
      await syncForecastsForArticle(article.id);
      /**
       * A pass that produced an analysis the model could not ground is not a success for the
       * retry cadence, and treating it as one is what made `needs_review` a terminal state.
       *
       * The automatic candidate filter is "articles with no analysis", so an article that
       * gets a `needs_review` row leaves that set for good — and because the success path
       * cleared the backoff counter on every attempt, adding `--retry-review` to the
       * scheduled pass on its own would have re-billed it once a minute, forever. Counting
       * it as a failure puts it on the same exponential ladder as one that throws: a second
       * look after thirty minutes, a third after an hour, and abandonment at MAX_FAILURES.
       * Operator-requested reruns still bypass the cadence, because someone looked at the
       * output and asked for it again.
       */
      if (parsed.reviewStatus === "needs_review") {
        await queueRetry(article.id, "analysis");
        const failures = await recordFailure(article.id, "analysis");
        console.log(`  HOLD (${failures}/${MAX_FAILURES}) ${article.id} · ${article.title}`);
      } else {
        await clearFailures(article.id, "analysis");
        console.log(`  ${parsed.needsLLM ? "HOLD" : "OK  "} ${article.id} · ${article.title}`);
      }
      updated++;
      } catch (error) {
        failed++;
        // Counted so an article that can never be parsed leaves the candidate set instead
        // of being re-billed on the next pass sixty seconds from now.
        const failures = await recordFailure(article.id, "analysis");
        console.error(`  FAIL (${failures}) ${article.id} · ${article.title}`, error);
      }
    }));
  }

  console.log(`Reparse complete: ${updated} updated · ${unresolved} unresolved · ${failed} failed.`);
  // A batch where every item failed is a failed run. Exiting 0 there told the scheduler
  // and the retry queue that a rerun had succeeded when nothing was actually produced.
  if (failed > 0 && updated === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
