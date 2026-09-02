import "dotenv/config";
import { prisma } from "../src/lib/db";
import { validateAnalysisGrounding } from "../src/lib/ingest/analysisGrounding";
import { queueRetry } from "../src/lib/contentRetry";

/**
 * Re-check stored analyses against their article body.
 *
 * New analyses are graded at parse time, but everything ingested before the check existed
 * carries an unverified `reviewStatus`. Reporting is the default; `--apply` writes the
 * verdict back, and `--queue-retry` asks for the failures to be regenerated.
 *
 *   npx tsx scripts/analysis-grounding.ts                  # report only
 *   npx tsx scripts/analysis-grounding.ts --apply
 *   npx tsx scripts/analysis-grounding.ts --apply --queue-retry --limit=25
 */
const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const apply = flag("apply");
const queue = flag("queue-retry");
const limit = Number(arg("limit") || 0);

const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

async function main() {
  const rows = await prisma.analysis.findMany({
    select: {
      id: true, articleId: true, reviewStatus: true,
      summary: true, summaryZh: true,
      keyArguments: true, keyArgumentsZh: true,
      keyNumbers: true, keyNumbersZh: true,
      risks: true, risksZh: true,
      interpretation: true, interpretationZh: true,
      article: { select: { rawText: true, title: true } },
    },
  });

  const byCode = new Map<string, number>();
  const failures: Array<{ articleId: string; was: string; issues: string[] }> = [];
  let checked = 0;
  let skipped = 0;
  let totalScore = 0;

  for (const row of rows) {
    if (!row.article.rawText) { skipped += 1; continue; }
    const result = validateAnalysisGrounding({
      summary: row.summary,
      summaryZh: row.summaryZh,
      keyArguments: parse<string[]>(row.keyArguments, []),
      keyArgumentsZh: parse<string[]>(row.keyArgumentsZh, []),
      keyNumbers: parse<Array<{ label?: string; value?: string }>>(row.keyNumbers, []),
      keyNumbersZh: parse<Array<{ label?: string; value?: string }>>(row.keyNumbersZh, []),
      risks: parse<string[]>(row.risks, []),
      risksZh: parse<string[]>(row.risksZh, []),
      interpretation: row.interpretation,
      interpretationZh: row.interpretationZh,
    }, `${row.article.title}\n${row.article.rawText}`);

    checked += 1;
    totalScore += result.score;
    if (result.passed) continue;

    for (const issue of result.issues) byCode.set(issue.code, (byCode.get(issue.code) ?? 0) + 1);
    failures.push({
      articleId: row.articleId,
      was: row.reviewStatus,
      issues: result.issues.slice(0, 5).map((issue) => `${issue.code}/${issue.field}:${issue.detail}`),
    });

    if (apply && row.reviewStatus !== "needs_review") {
      await prisma.analysis.update({ where: { id: row.id }, data: { reviewStatus: "needs_review" } });
    }
  }

  console.log(`checked:        ${checked} (skipped ${skipped} without source text)`);
  console.log(`failing:        ${failures.length} (${((failures.length / (checked || 1)) * 100).toFixed(1)}%)`);
  console.log(`mean score:     ${(totalScore / (checked || 1)).toFixed(3)}`);
  console.log(`issues by code:`, Object.fromEntries(byCode));
  console.log(`newly flagged:  ${failures.filter((failure) => failure.was === "ok").length}`);

  if (queue) {
    const targets = limit > 0 ? failures.slice(0, limit) : failures;
    for (const failure of targets) await queueRetry(failure.articleId, "analysis");
    console.log(`queued retries: ${targets.length}`);
  }

  if (!apply) console.log("\n(report only — pass --apply to write reviewStatus)");
  for (const failure of failures.slice(0, 15)) {
    console.log(`  ${failure.articleId} [${failure.was}] ${failure.issues.join(" | ")}`);
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
