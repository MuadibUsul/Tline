import "dotenv/config";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { pipelineAlertSignature, pipelineHealth, shouldNotifyPipeline, type PipelineHealth } from "../src/lib/pipelineHealth";
import { sendOpsAlert } from "../src/lib/social/feishu";

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
  return sendOpsAlert(
    [
      "pipeline.stalled",
      `reasons: ${health.stalled.join(", ") || "(none)"}`,
      `articleAgeHours: ${health.articleAgeHours ?? "n/a"}`,
      `viewAgeHours: ${health.viewAgeHours ?? "n/a"}`,
      `sources: ${health.workingSources}/${health.crawlableSources} succeeded in 24h`,
      `@ ${new Date().toISOString()}`,
    ].join("\n")
  );
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
  const statePath = path.join(process.env.RUNTIME_DIR || path.join(process.cwd(), ".runtime"), "pipeline-watchdog.json");
  if (health.stalled.length) {
    // A non-zero exit is what a supervisor or an operator's own check can act on.
    process.exitCode = 1;
    const previous = await readFile(statePath, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (shouldNotifyPipeline(health.stalled, previous) && await notify(health)) {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({ signature: pipelineAlertSignature(health.stalled), notifiedAt: Date.now() }));
    }
  } else {
    // A later incident must alert immediately, even if the previous one recovered recently.
    await unlink(statePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
