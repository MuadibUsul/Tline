import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getLLMProvider } from "../src/lib/llm/provider";
import { translateAndPersist } from "../src/lib/translation/translate";
import { generateArticleDocuments } from "../src/lib/documents/pdf";
import { queueRetry } from "../src/lib/contentRetry";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const provider = getLLMProvider(process.env.TRANSLATION_PROVIDER);
  if (!provider) {
    console.log("No translation provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or DEEPSEEK_API_KEY.");
    return;
  }
  const articleIds = (arg("ids") || arg("id") || "").split(",").filter(Boolean);
  const limit = Math.max(1, Number(arg("limit") || 20));
  const qualityBelow = Math.max(0, Math.min(1, Number(arg("quality-below") || 0.8)));
  const concurrency = Math.min(8, Math.max(1, Number(arg("concurrency") || process.env.TRANSLATION_CONCURRENCY || 3)));
  const rows = await prisma.article.findMany({
    where: articleIds.length ? { id: { in: articleIds }, rawText: { not: null } } : { rawText: { not: null } },
    select: {
      id: true,
      title: true,
      contentHash: true,
      translations: { where: { locale: "zh-CN" }, select: { status: true, qualityScore: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
  const candidates = rows
    .filter((article) => flag("all") || article.translations.length === 0 || (flag("retry-review") && article.translations[0].status === "needs_review") || (flag("retry-low-quality") && (article.translations[0].qualityScore ?? 0) < qualityBelow))
    .slice(0, limit);

  let translated = 0;
  let needsReview = 0;
  let failed = 0;
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    await Promise.all(candidates.slice(offset, offset + concurrency).map(async (article) => {
      try {
        const result = await translateAndPersist(article.id, provider, article.contentHash);
        await generateArticleDocuments(article.id);
        if (result.translation.status === "needs_review") await queueRetry(article.id, "translation");
        if (result.translation.status === "reviewed") translated++;
        else needsReview++;
        console.log(`  ${result.translation.status === "reviewed" ? "OK  " : "HOLD"} ${article.id} · ${article.title}`);
      } catch (error) {
        failed++;
        console.error(`  FAIL ${article.id} · ${article.title}`, error);
      }
    }));
  }
  console.log(`Translation complete: ${translated} reviewed · ${needsReview} needs review · ${failed} failed.`);
  // A batch where every item failed is a failed run. Exiting 0 there told the scheduler
  // and the retry queue that a rerun had succeeded when nothing was actually produced.
  if (failed > 0 && translated === 0 && needsReview === 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
