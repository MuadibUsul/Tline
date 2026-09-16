import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { repairReleasePreviousValues } from "../src/lib/macro/watch";

/**
 * Fill in previous values that the capture could not resolve, and invalidate the read-outs
 * that were written without them so the next analysis pass regenerates those.
 *
 *   npm run macro:repair            (dry-run: report what would change)
 *   npm run macro:repair -- --apply (write)
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const days = Math.max(1, Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] || 7));
  if (!apply) {
    // The derivation is read-only until the write below, so a dry run is a real rehearsal.
    const preview = await repairPreview(days);
    console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
    console.log("\nNothing written. Re-run with --apply to fill these in.");
    return;
  }
  await runTrackedJob("macro:repair-previous", { days }, async () => {
    const result = await repairReleasePreviousValues(new Date(), days);
    console.log(JSON.stringify({ event: "macro.repair.previous", releases: result.releases, repaired: result.repaired.length, staleReadOuts: result.staleReadOuts }));
    for (const row of result.repaired) console.log(JSON.stringify({ event: "macro.repair.previous.value", ...row }));
    return { result: undefined, metrics: { releases: result.releases, repaired: result.repaired.length, staleReadOuts: result.staleReadOuts } };
  });
}

/** Counts only, for the dry run: the write path is the same function with the flag on. */
async function repairPreview(days: number) {
  const releases = await prisma.macroRelease.count({
    where: { status: "RELEASED", releasedAt: { gte: new Date(Date.now() - days * 86_400_000) }, values: { some: { previousAtRelease: null } } },
  });
  return { releasesWithMissingPrevious: releases, days };
}

main().catch(async (error) => {
  console.error(String(error));
  await prisma.$disconnect();
  process.exit(1);
}).finally(() => prisma.$disconnect());
