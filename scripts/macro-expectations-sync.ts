import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { syncConsensusExpectations } from "../src/lib/macro/consensus/sync";

/**
 * Capture the market consensus for upcoming releases.
 *
 * Scheduled ahead of the releases it covers, because that is the only time the number is
 * still a forecast. Running late is not an error: releases that have already printed are
 * skipped by the sync, and anything recorded after the print can never become the live
 * snapshot (see the expectations module).
 */
async function main() {
  await runTrackedJob("macro:expectations", {}, async () => {
    const metrics = await syncConsensusExpectations();
    console.log(JSON.stringify({ event: "macro.consensus.sync", ...metrics }));
    if (metrics.rejected.length) console.warn(JSON.stringify({ event: "macro.consensus.rejected", reasons: metrics.rejected.slice(0, 10) }));
    return { result: undefined, metrics: { ...metrics } };
  });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String(error));
  await prisma.$disconnect();
  process.exit(1);
});
