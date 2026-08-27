import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseArticle } from "../src/lib/ingest/parseLLM";
import { syncForecastsForArticle } from "../src/lib/forecast";

const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !flag("heuristic")) {
    console.log("No supported LLM key configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY or pass --heuristic.");
    return;
  }

  const all = flag("all");
  const rows = await prisma.article.findMany({
    where: { rawText: { not: null } },
    select: {
      id: true,
      title: true,
      rawText: true,
      publishedAt: true,
      institution: { select: { name: true } },
      analysis: { select: { reviewStatus: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
  const candidates = rows.filter((row) => all || row.analysis?.reviewStatus === "needs_review");
  const assets = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  const assetIds = new Map(assets.map((asset) => [asset.ticker, asset.id]));

  let updated = 0;
  let unresolved = 0;
  let failed = 0;

  for (const article of candidates) {
    try {
      const parsed = await parseArticle({
        institution: article.institution.name,
        title: article.title,
        text: article.rawText!,
        publishedAt: article.publishedAt.toISOString(),
      });

      // Never erase an existing valid signal with another unresolved fallback.
      if (parsed.needsLLM) {
        unresolved++;
        console.log(`  HOLD ${article.id} · ${article.title}`);
        continue;
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
            keyArguments: JSON.stringify(parsed.keyArguments),
            keyNumbers: JSON.stringify(parsed.keyNumbers),
            risks: JSON.stringify(parsed.risks),
            interpretation: parsed.interpretation,
            importanceScore: parsed.importanceScore,
            confidence: parsed.confidence,
            provider: parsed.provider,
            model: parsed.model,
            promptVersion: parsed.promptVersion,
            reviewStatus: parsed.reviewStatus,
          },
          update: {
            summary: parsed.summary,
            keyArguments: JSON.stringify(parsed.keyArguments),
            keyNumbers: JSON.stringify(parsed.keyNumbers),
            risks: JSON.stringify(parsed.risks),
            interpretation: parsed.interpretation,
            importanceScore: parsed.importanceScore,
            confidence: parsed.confidence,
            provider: parsed.provider,
            model: parsed.model,
            promptVersion: parsed.promptVersion,
            reviewStatus: parsed.reviewStatus,
          },
        }),
        prisma.articleAsset.deleteMany({ where: { articleId: article.id } }),
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
      ]);
      await syncForecastsForArticle(article.id);
      updated++;
      console.log(`  OK   ${article.id} · ${article.title}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL ${article.id} · ${article.title}`, error);
    }
  }

  console.log(`Reparse complete: ${updated} updated · ${unresolved} unresolved · ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
