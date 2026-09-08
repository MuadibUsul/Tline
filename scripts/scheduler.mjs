import "dotenv/config";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { startWorkerHeartbeat } from "./worker-heartbeat.mjs";

const intervalMs = Math.max(60_000, Number(process.env.INGEST_INTERVAL_MS || 60_000));
// Keep analysis/translation close behind discovery. Source polling is publisher-bound,
// but once a report lands there is no reason to leave it unparsed for another five minutes.
const processingIntervalMs = Math.max(60_000, Number(process.env.PROCESS_INTERVAL_MS || 60_000));
const limit = Math.max(1, Number(process.env.INGEST_ARTICLE_LIMIT || 6));
const processLimit = Math.max(1, Number(process.env.PROCESS_ARTICLE_LIMIT || 50));
const retryLimit = Math.max(1, Number(process.env.JOB_RETRY_LIMIT || 3));
const retryBatch = Math.max(1, Number(process.env.CONTENT_RETRY_BATCH || 5));
const retryDelayMs = Math.max(10_000, Number(process.env.JOB_RETRY_DELAY_MS || 60_000));
const sourceConcurrency = Math.min(16, Math.max(1, Number(process.env.INGEST_CONCURRENCY || 8)));
const sourceSeconds = Math.min(600, Math.max(30, Number(process.env.INGEST_SOURCE_SECONDS || 90)));
const analyticsIntervalMs = Math.max(300_000, Number(process.env.ANALYTICS_ROLLUP_INTERVAL_MS || 3_600_000));
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmPrefix = process.platform === "win32" ? [process.env.npm_execpath] : [];
let stopping = false;
const activeChildren = new Set();
const waiters = new Set();

const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(process.cwd(), ".runtime"));
const lockPath = path.join(runtimeDir, "research-scheduler.lock");
mkdirSync(runtimeDir, { recursive: true });
let previous;
try {
  previous = Number(JSON.parse(readFileSync(lockPath, "utf8")).pid);
} catch (error) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
}
if (Number.isInteger(previous)) {
  try {
    process.kill(previous, 0);
    throw new Error(`Research scheduler is already running (pid ${previous}).`);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}
try { unlinkSync(lockPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
const lock = openSync(lockPath, "wx");
writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const prisma = new PrismaClient();
const recovered = await prisma.jobRun.updateMany({
  where: { name: "ingest", status: "running" },
  data: { status: "failed", error: "Research scheduler restarted before this ingest completed.", finishedAt: new Date() },
});
await prisma.$disconnect();
if (recovered.count) console.log(JSON.stringify({ event: "scheduler.recovered", jobs: recovered.count }));
const stopHeartbeat = await startWorkerHeartbeat("research", () => ({ activeChildren: activeChildren.size }));

function stop() {
  stopping = true;
  for (const child of activeChildren) child.kill("SIGTERM");
  for (const wake of waiters) wake();
}

function releaseLock() {
  try { closeSync(lock); } catch {}
  try { unlinkSync(lockPath); } catch {}
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("exit", releaseLock);

function wait(delay) {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      waiters.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, delay);
    waiters.add(wake);
  });
}

function runCommand(args) {
  return new Promise((resolve) => {
    const child = spawn(npm, [...npmPrefix, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    activeChildren.add(child);
    child.on("exit", (code, signal) => {
      activeChildren.delete(child);
      console.log(JSON.stringify({ event: "scheduler.command.exit", command: args.join(" "), code, signal }));
      resolve(code ?? 1);
    });
  });
}

const runIngest = (attempt) => runCommand(["run", "ingest", "--", "--all", "--due", `--limit=${limit}`, `--concurrency=${sourceConcurrency}`, `--source-seconds=${sourceSeconds}`, `--attempt=${attempt}`]);

async function processPending() {
  for (const args of [
    // Operator-requested reruns come first: someone looked at a specific report, judged its
    // AI output poor and asked for it again. Ahead of the routine backlog, not behind it.
    ["run", "retries", "--", `--batch=${retryBatch}`],
    ["run", "reparse", "--", `--limit=${processLimit}`],
    // Translation is not in this list. The site is English-only, so translating every
    // article body produced output nothing renders — and it was the largest single
    // consumer in the pipeline. The command still exists and still works if it is ever
    // wanted again; nothing runs it on a schedule.
    ["run", "documents", "--", `--limit=${processLimit}`],
    // Last, so it judges the pass that has just finished. A non-zero exit here means the
    // pipeline is quiet rather than broken, which no other signal reports.
    ["run", "watchdog"],
  ]) {
    if (stopping) return;
    const code = await runCommand(args);
    // The watchdog exits non-zero to report a quiet pipeline; it has already said so in
    // its own output and is not a failed command.
    if (code !== 0 && !args.includes("watchdog")) {
      console.error(JSON.stringify({ event: "scheduler.processing.failed", command: args.join(" "), code }));
    }
  }
}

async function notifyFailure() {
  const url = process.env.JOB_FAILURE_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "ingest.failed", attempts: retryLimit, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "scheduler.webhook.failed", error: String(error) }));
  }
}

async function ingestLoop() {
  while (!stopping) {
    const cycleStartedAt = Date.now();
    let succeeded = false;
    for (let attempt = 1; attempt <= retryLimit && !stopping; attempt++) {
      succeeded = (await runIngest(attempt)) === 0;
      if (succeeded || attempt === retryLimit) break;
      await wait(retryDelayMs * attempt);
    }
    if (!succeeded && !stopping) await notifyFailure();
    if (stopping) break;
    const waitMs = Math.max(1_000, intervalMs - (Date.now() - cycleStartedAt));
    console.log(JSON.stringify({ event: "scheduler.ingest.wait", intervalMs: waitMs }));
    await wait(waitMs);
  }
}

async function processingLoop() {
  while (!stopping) {
    await processPending();
    if (stopping) break;
    console.log(JSON.stringify({ event: "scheduler.processing.wait", intervalMs: processingIntervalMs }));
    await wait(processingIntervalMs);
  }
}

/**
 * Audience rollup and raw-row pruning.
 *
 * Its own loop on a much slower cadence: it is neither ingestion nor content processing,
 * and putting it in either would tie how often the analytics tables are pruned to how
 * fast publishers are polled. Recomputing recent days is idempotent, so an hourly pass
 * costs nothing and keeps the console current well before the day is over.
 */
async function analyticsLoop() {
  while (!stopping) {
    await runCommand(["run", "analytics:rollup"]);
    if (stopping) break;
    console.log(JSON.stringify({ event: "scheduler.analytics.wait", intervalMs: analyticsIntervalMs }));
    await wait(analyticsIntervalMs);
  }
}

await Promise.all([ingestLoop(), processingLoop(), analyticsLoop()]);
await stopHeartbeat();
