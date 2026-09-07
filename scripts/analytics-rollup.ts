import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { retentionDays, rollupRecent } from "../src/lib/analytics/rollup";
import { pruneLlmCalls } from "../src/lib/llm/report";

/**
 * Summarise recent days into `TrafficDaily`, then delete raw rows past the retention
 * window. Run hourly by the scheduler; safe to run by hand at any time.
 *
 * Tracked as a job so it shows up in the console beside every other scheduled pass: a
 * pruning task that fails quietly is how a database fills up unnoticed.
 */
const days = Math.max(1, Number(process.argv.find((argument) => argument.startsWith("--days="))?.split("=")[1] || 3));

runTrackedJob("analytics-rollup", { days, retentionDays: retentionDays() }, async () => {
  const { rolled, pruned } = await rollupRecent(days);
  // Model-call rows ride along on the same pass: they are raw per-event rows with a
  // retention window, exactly like the traffic rows above, and giving them their own
  // scheduled task would be a second thing to notice had stopped running.
  const prunedLlmCalls = await pruneLlmCalls();
  return {
    result: undefined,
    metrics: {
      prunedLlmCalls,
      days: rolled.length,
      views: rolled.reduce((total, day) => total + day.views, 0),
      rows: rolled.reduce((total, day) => total + day.rows, 0),
      prunedBefore: pruned.before,
      pruned: pruned.pageViews + pruned.events + pruned.vitals,
    },
  };
}).catch((error: unknown) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
