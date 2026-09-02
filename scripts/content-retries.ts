import "dotenv/config";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { claimQueuedRetries, completeRetry, queueRetry, releaseStaleRetries, RETRY_KINDS } from "../src/lib/contentRetry";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const batch = Math.max(1, Number(arg("batch") || process.env.CONTENT_RETRY_BATCH || 5));

// Spawn the tsx CLI directly rather than going through `npm run`. npm's own launcher is a
// .cmd on Windows, which needs a shell, which concatenates arguments — and `npm_execpath`
// points at npx when this script is itself invoked through npx. node + a resolved .mjs is
// the same on every platform and keeps arguments as an array.
// tsx does not export its CLI as a subpath, so resolve it through the package manifest.
const tsxManifest = createRequire(import.meta.url).resolve("tsx/package.json");
const tsxCli = path.join(path.dirname(tsxManifest), "dist", "cli.mjs");

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, script, ...args], { stdio: "inherit", env: process.env });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Drain the operator-requested rerun queue.
 *
 * `--all` is passed to the downstream script on purpose: the article was explicitly chosen
 * by a human, so it must be reprocessed even though it already has an analysis or a
 * translation, which is exactly what the default filters skip.
 */
/**
 * Bulk-enqueue the existing backlog. Separated from draining on purpose: queueing is free
 * and instant, draining costs model calls, so the operator decides the pace by how often
 * the drain runs rather than by one very long command.
 */
async function enqueueBacklog(): Promise<number> {
  const below = Math.max(0, Math.min(1, Number(arg("below") || 0.8)));
  const max = Math.max(1, Number(arg("max") || 500));

  const translations = await prisma.articleTranslation.findMany({
    where: { locale: "zh-CN", OR: [{ qualityScore: { lt: below } }, { qualityScore: null }, { status: "needs_review" }] },
    orderBy: { qualityScore: "asc" },
    take: max,
    select: { articleId: true },
  });
  for (const row of translations) await queueRetry(row.articleId, "translation");

  const analyses = await prisma.analysis.findMany({
    where: { reviewStatus: "needs_review" },
    take: max,
    select: { articleId: true },
  });
  for (const row of analyses) await queueRetry(row.articleId, "analysis");

  console.log(JSON.stringify({
    event: "retries.enqueued",
    translations: translations.length,
    analyses: analyses.length,
    qualityBelow: below,
  }));
  return translations.length + analyses.length;
}

async function main() {
  if (process.argv.includes("--enqueue-backlog")) {
    await enqueueBacklog();
    if (!process.argv.includes("--drain")) return;
  }
  const released = await releaseStaleRetries();
  if (released) console.log(JSON.stringify({ event: "retries.released", count: released }));

  let processed = 0;
  let failed = 0;

  for (const kind of RETRY_KINDS) {
    const claimed = await claimQueuedRetries(kind, batch);
    if (!claimed.length) continue;
    const ids = claimed.map((row) => row.articleId).join(",");
    const script = kind === "analysis" ? "prisma/reparse.ts" : "prisma/translate.ts";
    console.log(JSON.stringify({ event: "retries.start", kind, count: claimed.length }));

    const code = await run(script, [`--ids=${ids}`, "--all"]);
    for (const row of claimed) {
      const result = await completeRetry(row.id, row.articleId, kind, code === 0 ? null : `${script} exited ${code}`);
      processed += 1;
      if (result.status === "failed") failed += 1;
      console.log(JSON.stringify({
        event: "retries.complete",
        kind,
        articleId: row.articleId,
        status: result.status,
        scoreBefore: result.scoreBefore,
        scoreAfter: result.scoreAfter,
      }));
    }
  }

  console.log(JSON.stringify({ event: "retries.done", processed, failed }));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
