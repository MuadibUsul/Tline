import "dotenv/config";
import { prisma } from "../src/lib/db";

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

const STALL_HOURS = Math.max(1, Number(process.env.INGEST_STALL_HOURS || 6));
const VIEW_STALL_HOURS = Math.max(1, Number(process.env.VIEW_STALL_HOURS || 12));

export interface PipelineHealth {
  articleAgeHours: number | null;
  viewAgeHours: number | null;
  crawlableSources: number;
  workingSources: number;
  stalled: string[];
}

const hoursSince = (value: Date | null) => (value ? (Date.now() - value.getTime()) / 3_600_000 : null);

export async function pipelineHealth(): Promise<PipelineHealth> {
  const [article, view, crawlable, working] = await Promise.all([
    prisma.article.aggregate({ _max: { createdAt: true } }),
    prisma.atomicView.aggregate({ _max: { createdAt: true } }),
    prisma.institution.count({ where: { monitoringEnabled: true, crawlPolicy: { in: ["allowed", "delayed"] } } }),
    prisma.institution.count({ where: { lastSuccessAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } }),
  ]);

  const articleAgeHours = hoursSince(article._max.createdAt);
  const viewAgeHours = hoursSince(view._max.createdAt);
  const stalled: string[] = [];

  if (articleAgeHours === null) stalled.push("no research has ever been stored");
  else if (articleAgeHours > STALL_HOURS) stalled.push(`no research stored for ${articleAgeHours.toFixed(1)}h`);

  // Views lag research, so they are given longer before silence counts as a stall.
  if (articleAgeHours !== null && viewAgeHours !== null && viewAgeHours > VIEW_STALL_HOURS) {
    stalled.push(`no views extracted for ${viewAgeHours.toFixed(1)}h`);
  }
  // Sources can each be "succeeding" while none of them returns anything.
  if (crawlable > 0 && working === 0) stalled.push("no source has succeeded in 24h");

  return { articleAgeHours, viewAgeHours, crawlableSources: crawlable, workingSources: working, stalled };
}

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
