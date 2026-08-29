import { spawn } from "node:child_process";

const intervalMs = Math.max(60_000, Number(process.env.INGEST_INTERVAL_MS || 6 * 60 * 60 * 1000));
const limit = Math.max(1, Number(process.env.INGEST_ARTICLE_LIMIT || 6));
const processLimit = Math.max(1, Number(process.env.PROCESS_ARTICLE_LIMIT || 50));
const retryLimit = Math.max(1, Number(process.env.JOB_RETRY_LIMIT || 3));
const retryDelayMs = Math.max(10_000, Number(process.env.JOB_RETRY_DELAY_MS || 60_000));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let stopping = false;
let activeChild;
let wake;

function stop() {
  stopping = true;
  activeChild?.kill("SIGTERM");
  wake?.();
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

function wait(delay) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delay);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  }).finally(() => { wake = undefined; });
}

function runCommand(args) {
  return new Promise((resolve) => {
    activeChild = spawn(npm, args, {
      stdio: "inherit",
      env: process.env,
    });
    activeChild.on("exit", (code, signal) => {
      activeChild = undefined;
      console.log(JSON.stringify({ event: "scheduler.command.exit", command: args.join(" "), code, signal }));
      resolve(code ?? 1);
    });
  });
}

const runIngest = (attempt) => runCommand(["run", "ingest", "--", "--all", `--limit=${limit}`, `--attempt=${attempt}`]);

async function processPending() {
  for (const args of [
    ["run", "reparse", "--", `--limit=${processLimit}`],
    ["run", "translate", "--", `--limit=${processLimit}`],
    ["run", "documents", "--", `--limit=${processLimit}`],
  ]) {
    if (stopping) return;
    const code = await runCommand(args);
    if (code !== 0) console.error(JSON.stringify({ event: "scheduler.processing.failed", command: args.join(" "), code }));
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

async function loop() {
  while (!stopping) {
    let succeeded = false;
    for (let attempt = 1; attempt <= retryLimit && !stopping; attempt++) {
      succeeded = (await runIngest(attempt)) === 0;
      if (succeeded || attempt === retryLimit) break;
      await wait(retryDelayMs * attempt);
    }
    if (!succeeded && !stopping) await notifyFailure();
    if (succeeded && !stopping) await processPending();
    if (stopping) break;
    console.log(JSON.stringify({ event: "scheduler.wait", intervalMs }));
    await wait(intervalMs);
  }
}

await loop();
