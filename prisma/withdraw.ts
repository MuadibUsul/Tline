import "dotenv/config";
import { prisma } from "../src/lib/db";
import { isNoiseTitle } from "../src/lib/contentQuality";

/**
 * Takes a report down, or puts it back.
 *
 *   npm run withdraw -- --list                    what is withdrawn now
 *   npm run withdraw -- --ids=<id,id> --reason="..."   take those down
 *   npm run withdraw -- --restore --ids=<id,id>        put them back
 *   npm run withdraw -- --noise-titles --dry-run       every report whose title is a label
 *
 * Withdrawal is a column, not a delete: the report, its analysis, its translation and its
 * stored PDF all stay, and the page returns the moment the column is cleared. Deleting
 * would also destroy the record of what was published, which is what the corrections and
 * audit surfaces are for.
 *
 * `--noise-titles` exists because a title the gate calls a label is the one defect that
 * cannot be repaired generically. Run `npm run retitle` FIRST: it recovers the real
 * headline from the stored PDF where one exists — `Download the PDF "Fueling Resilience"`
 * is a wrapper around a usable title — and refuses when the recovered title is shared
 * across reports. What it declines is what this flag should find, so a report that could
 * have been saved is not taken down because the two commands ran in the wrong order.
 */
function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const ids = (arg("ids") || "").split(",").map((value) => value.trim()).filter(Boolean);
  const restore = flag("restore");
  const dryRun = flag("dry-run");

  if (flag("list")) {
    const withdrawn = await prisma.article.findMany({
      where: { withdrawnAt: { not: null } },
      select: { id: true, slug: true, title: true, withdrawnAt: true, institution: { select: { name: true } } },
      orderBy: { withdrawnAt: "desc" },
    });
    console.log(`${withdrawn.length} withdrawn report(s).`);
    for (const row of withdrawn) console.log(`  ${row.withdrawnAt?.toISOString().slice(0, 10)}  ${row.id}  ${row.institution.name} · ${row.title.slice(0, 70)}`);
    return;
  }

  let targets = ids;
  if (flag("noise-titles")) {
    const candidates = await prisma.article.findMany({
      where: { withdrawnAt: null },
      select: { id: true, title: true, institution: { select: { name: true } } },
    });
    targets = candidates.filter((row) => isNoiseTitle(row.title)).map((row) => row.id);
    console.log(`${targets.length} report(s) carry a title the gate reads as a document label:`);
    for (const row of candidates.filter((candidate) => isNoiseTitle(candidate.title)).slice(0, 30)) {
      console.log(`  ${row.institution.name} · ${row.title.slice(0, 70)}`);
    }
  }

  if (!targets.length) {
    console.log("Nothing selected. Pass --ids=... or --noise-titles.");
    return;
  }
  if (dryRun) {
    console.log(`dry run: would ${restore ? "restore" : "withdraw"} ${targets.length} report(s).`);
    return;
  }

  const result = await prisma.article.updateMany({
    where: { id: { in: targets } },
    data: { withdrawnAt: restore ? null : new Date() },
  });
  console.log(`${restore ? "Restored" : "Withdrawn"} ${result.count} report(s).`);
  console.log(restore
    ? "They return to the sitemap, the feeds and their pages on the next request."
    : "They leave the sitemap, the feeds, the read API and their pages, which now answer 404.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
