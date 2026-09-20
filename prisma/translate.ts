import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { resolveLLMProvider } from "../src/lib/llm/config";
import { translateAndPersist, translationInputs } from "../src/lib/translation/translate";
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
  /**
   * Whether this pass lifts the new-article cutoff and sweeps the whole corpus.
   *
   * Separate from `--all` on purpose, and it does not imply it. `--all` means "take what I
   * named, whether or not it looks like work" and forces a rewrite; on a schedule that is
   * a standing charge — the query would hand back the same newest articles every tick and
   * each one would be re-translated again. `--backlog` means "find the rows that are
   * actually stale, all the way back", which is idempotent: once swept, the next pass finds
   * nothing and costs nothing.
   */
  const backlog = flag("backlog") || /^(?:1|true|yes)$/i.test(process.env.TRANSLATION_BACKLOG ?? "");
  // An operator who named ids, or asked for everything, gets what they asked for; backoff
  // and the new-article cutoff only govern the automatic pass the scheduler runs every minute.
  const operatorSelected = articleIds.length > 0 || flag("all");
  const selection: Prisma.ArticleWhereInput[] = [];
  if (!operatorSelected) {
    // Backoff governs the backlog too, so a report that cannot be translated leaves the
    // candidate set instead of being re-billed on every pass.
    selection.push(dueFilter("translation"));
    // No backfill by default: the automatic pass only translates reports first ingested on
    // or after the cutoff, so the pre-cutoff corpus is never a bill nobody chose.
    if (!backlog) selection.push({ createdAt: { gte: LOCALE_STRICT_ZH_SINCE } });
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
      // The staleness fields come back with the row so the decision below can be made
      // before a model call, not inside `translateAndPersist` after one has been claimed.
      translations: {
        where: { locale: "zh-CN" },
        select: { status: true, qualityScore: true, promptVersion: true, glossaryVersion: true, sourceContentHash: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    // The status/quality predicates below read the translation rows, so they cannot move
    // into the query; take enough headroom that a page of already-done articles still
    // yields a full batch, rather than scanning the whole table as this once did.
    take: articleIds.length ? undefined : limit * 10,
  });
  const { promptVersion: currentPrompt, glossaryVersion: currentGlossary } = translationInputs();
  /** A row this pass would actually rewrite, judged by the same test the reuse check applies. */
  const needsWork = (article: (typeof rows)[number]) => {
    const existing = article.translations[0];
    if (!existing) return true;
    if (existing.promptVersion !== currentPrompt) return true;
    if (existing.glossaryVersion !== currentGlossary) return true;
    if (existing.sourceContentHash !== article.contentHash) return true;
    if (flag("retry-review") && existing.status === "needs_review") return true;
    if (flag("retry-low-quality") && (existing.qualityScore ?? 0) < qualityBelow) return true;
    return false;
  };
  const candidates = rows
    // An operator's selection is taken as asked. The automatic and backlog passes only take
    // what is genuinely outstanding, which is what keeps either of them safe to schedule.
    .filter((article) => operatorSelected || needsWork(article))
    .slice(0, limit);

  let translated = 0;
  let needsReview = 0;
  let failed = 0;
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    await Promise.all(candidates.slice(offset, offset + concurrency).map(async (article) => {
      try {
        const result = await translateAndPersist(article.id, provider, article.contentHash, { force: operatorSelected });
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
