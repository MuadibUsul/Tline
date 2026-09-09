import "dotenv/config";
import { prisma } from "../src/lib/db";
import { pipelineHealth, type PipelineHealth } from "../src/lib/pipelineHealth";

/**
 * Reports a pipeline that has gone quiet while appearing healthy.
 *
 * Every existing signal is about something failing: a job that errored, a source that
 * refused a request, a worker that stopped sending a heartbeat. None of them fire when
 * each pass succeeds and simply brings nothing back — which is the failure that actually
 * happened here, repeatedly, and was noticed by a person rather than by the system.
 *
 * It reports rather than repairs, because the causes are not things a process can fix:
 * a listing that moved, a date written in a form the parser did not know, a window that
 * excluded everything. The point is that a person hears about it the same day.
 */

async function notify(health: PipelineHealth) {
  const url = process.env.JOB_FAILURE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "pipeline.stalled",
        reasons: health.stalled,
        articleAgeHours: health.articleAgeHours,
        viewAgeHours: health.viewAgeHours,
        sources: `${health.workingSources}/${health.crawlableSources} succeeded in 24h`,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "watchdog.webhook.failed", error: String(error) }));
  }
}

async function main() {
  const health = await pipelineHealth();
  console.log(JSON.stringify({
    event: health.stalled.length ? "pipeline.stalled" : "pipeline.healthy",
    articleAgeHours: health.articleAgeHours === null ? null : Number(health.articleAgeHours.toFixed(2)),
    viewAgeHours: health.viewAgeHours === null ? null : Number(health.viewAgeHours.toFixed(2)),
    sources: { working: health.workingSources, crawlable: health.crawlableSources },
    reasons: health.stalled,
  }));
  if (health.stalled.length) {
    await notify(health);
    // A non-zero exit is what a supervisor or an operator's own check can act on.
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
