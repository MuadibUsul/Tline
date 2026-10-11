import "dotenv/config";
import { prisma } from "../src/lib/db";
import { validateTranslation } from "../src/lib/translation/quality";
import { refreshGate } from "../src/lib/gate";

/**
 * Re-score stored translations against the current quality checker.
 *
 * Scores are written at translation time, so a change to the checker leaves every existing
 * row graded by the old rules. Reporting is the default; `--apply` rewrites `qualityScore`
 * and `status` so the site's quality notices reflect the checker actually in force.
 *
 * `--apply` also refreshes the publication gate for every article it touched: the gate's
 * verdict reads the translation's score and status, and the listings and sitemap trust the
 * stored columns. Skipping the refresh would leave a listing advertising a report whose
 * page now answers 404 — the exact disagreement the gate exists to prevent.
 *
 *   npx tsx scripts/translation-quality.ts
 *   npx tsx scripts/translation-quality.ts --apply
 */
const apply = process.argv.includes("--apply");

const bucket = (score: number) =>
  score >= 0.8 ? ">=0.8" : score >= 0.6 ? "0.6-0.8" : score >= 0.3 ? "0.3-0.6" : "<0.3";

async function main() {
  const rows = await prisma.articleTranslation.findMany({
    where: { locale: "zh-CN" },
    select: {
      id: true, articleId: true, text: true, qualityScore: true, status: true,
      article: { select: { rawText: true } },
      _count: { select: { segments: true } },
    },
  });

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const byCode = new Map<string, number>();
  const touched = new Set<string>();
  let scored = 0;
  let sumBefore = 0;
  let sumAfter = 0;
  let improved = 0;
  let worsened = 0;

  for (const row of rows) {
    if (!row.article.rawText) continue;
    const result = validateTranslation(row.article.rawText, row.text);
    scored += 1;
    const previous = row.qualityScore ?? 0;
    sumBefore += previous;
    sumAfter += result.score;
    before.set(bucket(previous), (before.get(bucket(previous)) ?? 0) + 1);
    after.set(bucket(result.score), (after.get(bucket(result.score)) ?? 0) + 1);
    for (const issue of result.issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
    if (result.score > previous + 0.001) improved += 1;
    if (result.score < previous - 0.001) worsened += 1;

    if (apply) {
      await prisma.articleTranslation.update({
        where: { id: row.id },
        data: {
          qualityScore: result.score,
          // Below the publication-quality bar the row is held for review, but stays public.
          status: result.score >= 0.8 ? "reviewed" : "needs_review",
        },
      });
      touched.add(row.articleId);
    }
  }

  if (apply && touched.size) {
    let flipped = 0;
    for (const articleId of touched) {
      const verdict = await refreshGate(articleId);
      if (verdict && !verdict.indexable["zh-CN"]) flipped += 1;
    }
    console.log(`gate refreshed: ${touched.size} articles, zh pages now withheld: ${flipped}`);
  }

  const order = [">=0.8", "0.6-0.8", "0.3-0.6", "<0.3"];
  console.log(`scored:        ${scored}`);
  console.log(`mean before:   ${(sumBefore / (scored || 1)).toFixed(3)}`);
  console.log(`mean after:    ${(sumAfter / (scored || 1)).toFixed(3)}`);
  console.log(`re-scored up:  ${improved}   down: ${worsened}`);
  console.log(`buckets before:`, Object.fromEntries(order.map((key) => [key, before.get(key) ?? 0])));
  console.log(`buckets after: `, Object.fromEntries(order.map((key) => [key, after.get(key) ?? 0])));
  console.log(`issues by code:`, Object.fromEntries(byCode));
  if (!apply) console.log("\n(report only — pass --apply to write qualityScore/status)");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
