import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { translateAndPersist } from "../src/lib/translation/translate";
import { generateArticleDocuments } from "../src/lib/documents/pdf";
import { clearFailures, dueFilter, recordFailure } from "../src/lib/articleBackoff";
import { queueRetry } from "../src/lib/contentRetry";
import { LOCALE_STRICT_ZH_SINCE } from "../src/lib/publication";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const provider = await resolveLLMProvider("translation");
  if (!provider) {
    console.log("No translation provider is configured, or the translation task is switched off in the console (Platform -> Model providers).");
    return;
  }
  const articleIds = (arg("ids") || arg("id") || "").split(",").filter(Boolean);
  const limit = Math.max(1, Number(arg("limit") || 20));
  const qualityBelow = Math.max(0, Math.min(1, Number(arg("quality-below") || 0.8)));
  const concurrency = Math.min(8, Math.max(1, Number(arg("concurrency") || process.env.TRANSLATION_CONCURRENCY || 3)));
  // An operator who named ids, or asked for everything, gets what they asked for; backoff
  // and the new-article cutoff only govern the automatic pass the scheduler runs every minute.
  const operatorSelected = articleIds.length > 0 || flag("all");
  const selection: Prisma.ArticleWhereInput[] = [];
  if (!operatorSelected) {
    selection.push(dueFilter("translation"));
    // No backfill: the automatic pass only translates reports first ingested on or after the
    // cutoff. The existing backlog is left untouched (run `translate --all` to backfill by hand).
    selection.push({ createdAt: { gte: LOCALE_STRICT_ZH_SINCE } });
  }
  const rows = await prisma.article.findMany({
    where: {
      rawText: { not: null },
      ...(articleIds.length ? { id: { in: articleIds } } : {}),
      ...(selection.length ? { AND: selection } : {}),
    },
    select: {
      id: true,
      title: true,
      contentHash: true,
      translations: { where: { locale: "zh-CN" }, select: { status: true, qualityScore: true } },
    },
    orderBy: { publishedAt: "desc" },
    // The status/quality predicates below read the translation rows, so they cannot move
    // into the query; take enough headroom that a page of already-done articles still
    // yields a full batch, rather than scanning the whole table as this once did.
    take: articleIds.length ? undefined : limit * 10,
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
        await clearFailures(article.id, "translation");
        if (result.translation.status === "needs_review") await queueRetry(article.id, "translation");
        if (result.translation.status === "reviewed") translated++;
        else needsReview++;
        console.log(`  ${result.translation.status === "reviewed" ? "OK  " : "HOLD"} ${article.id} · ${article.title}`);
      } catch (error) {
        failed++;
        // Counted so an article that can never be translated leaves the candidate set
        // instead of being re-billed on the next pass sixty seconds from now.
        const failures = await recordFailure(article.id, "translation");
        console.error(`  FAIL (${failures}) ${article.id} · ${article.title}`, error);
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
