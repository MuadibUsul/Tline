import "dotenv/config";
import { recomputeGates } from "../src/lib/gate";
import { prisma } from "../src/lib/db";

/**
 * Recompute the publication gate's stored verdict.
 *
 *   npm run gate:recompute              every article
 *   npm run gate:recompute -- --limit=500
 *   npm run gate:recompute -- --ids=<id,id>
 *   npm run gate:recompute -- --report  print the reasons, write nothing
 *
 * Every writer that moves a gate input recomputes on its own — ingest, reparse, translate,
 * retitle, and an operator approving a review — so this exists for two cases: filling the
 * column in for a corpus that predates it (a deployment that just added it, since the value
 * defaults to false and no listing will offer a report until the truth is written), and
 * repairing a sweep whose writer was missed.
 *
 * `--report` is the useful half of the other two: it answers "why is this report not public"
 * from the stored row, which before this column existed could only be answered by loading the
 * article and running the gate — the reason lived inside a request and nowhere else.
 */
function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const ids = (arg("ids") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const limit = Number(arg("limit")) || undefined;

  if (flag("report")) {
    const rows = await prisma.article.findMany({
      where: ids.length ? { id: { in: ids } } : {},
      select: { id: true, title: true, indexableEn: true, indexableZh: true, gateIssuesEn: true, gateIssuesZh: true, gateCheckedAt: true },
      orderBy: { publishedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });
    const unread = rows.filter((row) => !row.gateCheckedAt).length;
    const hiddenEn = rows.filter((row) => !row.indexableEn).length;
    const hiddenZh = rows.filter((row) => !row.indexableZh).length;
    console.log(`${rows.length} article(s): English public ${rows.length - hiddenEn}, Chinese public ${rows.length - hiddenZh}, never checked ${unread}`);
    const reasons = new Map<string, number>();
    for (const row of rows) {
      if (row.indexableEn) continue;
      for (const issue of JSON.parse(row.gateIssuesEn ?? "[]") as string[]) reasons.set(issue, (reasons.get(issue) ?? 0) + 1);
    }
    console.log("");
    console.log("why the English page is withheld:");
    for (const [issue, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${issue}`);
    await prisma.$disconnect();
    return;
  }

  const result = await recomputeGates({ ids, limit });
  console.log(JSON.stringify(result));
  console.log("Written. A report that now passes appears in the listings and the sitemap on the next request.");
  await prisma.$disconnect();
}

main()
  .catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
