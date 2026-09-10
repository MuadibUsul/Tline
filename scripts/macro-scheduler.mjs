import "dotenv/config";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { startWorkerHeartbeat } from "./worker-heartbeat.mjs";

const npm = process.platform === "win32" ? process.execPath : "npm";
const npmPrefix = process.platform === "win32" ? [process.env.npm_execpath] : [];
const sqlite = (process.env.DATABASE_URL || "").startsWith("file:");
const retryLimit = positive("MACRO_JOB_RETRY_LIMIT", 3, 1);
const retryDelayMs = positive("MACRO_JOB_RETRY_DELAY_MS", 30_000, 1_000);
const tasks = [
  task("calendar", "MACRO_CALENDAR_INTERVAL_MS", 6 * 60 * 60_000, ["run", "macro:calendar"]),
  task("provider-sync", "MACRO_PROVIDER_SYNC_INTERVAL_MS", 60 * 60_000, ["run", "macro:sync", "--", "--all"], "observations"),
  // The watcher also generates the bilingual read-out inline, once, the moment a print is
  // captured (see watchRelease) — so a fresh release is analysed within seconds of landing,
  // not on a separate minutes-scale poll. No standalone release-analysis task: it fired once
  // per release anyway, and doing it at the capture instant removes the extra latency.
  task("release-watch", "MACRO_RELEASE_WATCH_INTERVAL_MS", 10_000, ["run", "macro:watch"], "observations"),
  task("revision-sync", "MACRO_REVISION_SYNC_INTERVAL_MS", 24 * 60 * 60_000, ["run", "macro:revision"], "observations"),
  task("policy-sync", "MACRO_POLICY_SYNC_INTERVAL_MS", 6 * 60 * 60_000, ["run", "macro:policy"]),
  // Skips itself cleanly when no market-data licence is configured.
  //
  // 30 minutes, not 15: one pass costs one request per instrument, and Twelve Data's free
  // tier allows 800 a day. Seven instruments at 15 minutes is 672 requests — technically
  // under the cap, but with no headroom for a backfill or a manual run. At 30 minutes it is
  // 336. Institutional research moves in days and weeks, so the faster poll bought nothing.
  task("market-sync", "MACRO_MARKET_SYNC_INTERVAL_MS", 30 * 60_000, ["run", "macro:market"], "observations"),
  // Bridges macro/market observations into PriceObservation, then settles what is due.
  task("forecast-settle", "MACRO_FORECAST_SETTLE_INTERVAL_MS", 6 * 60 * 60_000, ["run", "forecasts"], "observations"),
  task("alerts", "MACRO_ALERT_INTERVAL_MS", 60_000, ["run", "macro:alerts"]),
];
const active = new Map();
const locks = new Set();
let stopping = false;
let wake;

const prisma = new PrismaClient();
const recovered = await prisma.jobRun.updateMany({
  where: { status: "running", name: { startsWith: "macro:" } },
  data: { status: "failed", error: "Macro scheduler restarted before this job completed.", finishedAt: new Date() },
});
await prisma.$disconnect();
if (recovered.count) console.log(JSON.stringify({ event: "macro.scheduler.recovered", jobs: recovered.count }));
const stopHeartbeat = await startWorkerHeartbeat("macro", () => ({ activeTasks: [...active.keys()] }));

function positive(name, fallback, minimum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric.`);
  return Math.max(minimum, value);
}

function task(name, envName, fallback, command, lock = null) {
  return { name, intervalMs: positive(envName, fallback, 10_000), command, lock: sqlite ? "database" : lock, nextAt: 0 };
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  }).finally(() => { wake = undefined; });
}

function runCommand(job, attempt) {
  return new Promise((resolve) => {
    const child = spawn(npm, [...npmPrefix, ...job.command], { stdio: "inherit", env: { ...process.env, JOB_ATTEMPT: String(attempt) } });
    active.set(job.name, child);
    if (job.lock) locks.add(job.lock);
    child.once("exit", (code, signal) => {
      active.delete(job.name);
      if (job.lock) locks.delete(job.lock);
      console.log(JSON.stringify({ event: "macro.scheduler.exit", job: job.name, attempt, code, signal }));
      resolve(code ?? 1);
    });
  });
}

async function notify(job) {
  const url = process.env.JOB_FAILURE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "macro.job.failed", job: job.name, attempts: retryLimit, timestamp: new Date().toISOString() }), signal: AbortSignal.timeout(10_000) });
  } catch (error) { console.error(JSON.stringify({ event: "macro.scheduler.webhook.failed", job: job.name, error: String(error) })); }
}

async function runTask(job) {
  if (active.has(job.name) || job.lock && locks.has(job.lock) || stopping) return;
  for (let attempt = 1; attempt <= retryLimit && !stopping; attempt++) {
    if (await runCommand(job, attempt) === 0) return;
    if (attempt < retryLimit) await wait(retryDelayMs * attempt);
  }
  if (!stopping) await notify(job);
}

function stop() {
  stopping = true;
  for (const child of active.values()) child.kill("SIGTERM");
  wake?.();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

while (!stopping) {
  const now = Date.now();
  for (const job of tasks) {
    if (now < job.nextAt || active.has(job.name) || job.lock && locks.has(job.lock)) continue;
    job.nextAt = now + job.intervalMs;
    void runTask(job);
  }
  await wait(Math.min(5_000, Math.max(250, Math.min(...tasks.map((job) => job.nextAt)) - Date.now())));
}
await Promise.all([...active.values()].map((child) => new Promise((resolve) => child.once("exit", resolve))));
await stopHeartbeat();
