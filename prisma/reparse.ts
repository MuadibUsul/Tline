import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseArticle } from "../src/lib/ingest/parseLLM";
import { syncForecastsForArticle } from "../src/lib/forecast";
import { queueRetry } from "../src/lib/contentRetry";

const flag = (name: string) => process.argv.includes(`--${name}`);
const articleIds = (process.argv.find((arg) => arg.startsWith("--ids="))?.slice(6) || process.argv.find((arg) => arg.startsWith("--id="))?.slice(5) || "").split(",").filter(Boolean);
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 1) : undefined;
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="));
const concurrency = Math.min(8, Math.max(1, Number(concurrencyArg?.split("=")[1] || process.env.REPARSE_CONCURRENCY || 3)));

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY && !flag("heuristic")) {
    console.log("No supported LLM key configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY or pass --heuristic.");
    return;
  }

  const all = flag("all");
  const retryReview = flag("retry-review");
  const rows = await prisma.article.findMany({
    where: articleIds.length ? { id: { in: articleIds }, rawText: { not: null } } : { rawText: { not: null } },
    select: {
      id: true,
      title: true,
      rawText: true,
      publishedAt: true,
      institution: { select: { name: true } },
      segments: { select: { heading: true, text: true }, orderBy: { position: "asc" } },
      analysis: { select: { reviewStatus: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
  const pending = rows.filter((row) => all || !row.analysis || (retryReview && row.analysis.reviewStatus === "needs_review"));
  const candidates = limit ? pending.slice(0, limit) : pending;
  const assets = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  const assetIds = new Map(assets.map((asset) => [asset.ticker, asset.id]));

  let updated = 0;
  let unresolved = 0;
  let failed = 0;

  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    await Promise.all(candidates.slice(offset, offset + concurrency).map(async (article) => {
      try {
      const parsed = await parseArticle({
        institution: article.institution.name,
        title: article.title,
        text: article.rawText!,
        publishedAt: article.publishedAt.toISOString(),
      }, article.segments);

      if (parsed.needsLLM) {
        unresolved++;
      }

      const uniqueSignals = [...new Map(
        parsed.assets
          .filter((signal) => assetIds.has(signal.ticker))
          .map((signal) => [signal.ticker, signal]),
      ).values()];

      await prisma.$transaction([
        prisma.analysis.upsert({
          where: { articleId: article.id },
          create: {
            articleId: article.id,
            summary: parsed.summary,
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
          },
          update: {
            summary: parsed.summary,
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
          },
        }),
        prisma.articleAsset.deleteMany({ where: { articleId: article.id } }),
        prisma.atomicView.deleteMany({ where: { articleId: article.id } }),
        ...uniqueSignals.map((signal) => prisma.articleAsset.create({
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
        ...parsed.atomicViews.map((view, position) => prisma.atomicView.create({
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
      // One automatic second pass for low-quality model output. During that retry the
      // queue row is already "running", so queueRetry is a no-op and cannot loop forever.
      if (parsed.reviewStatus === "needs_review") await queueRetry(article.id, "analysis");
      await syncForecastsForArticle(article.id);
        updated++;
        console.log(`  ${parsed.needsLLM ? "HOLD" : "OK  "} ${article.id} · ${article.title}`);
      } catch (error) {
        failed++;
        console.error(`  FAIL ${article.id} · ${article.title}`, error);
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
