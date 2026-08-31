import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { watchMacroReleases } from "../src/lib/macro/watch";

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const releaseId = argument("release-id");
  const nowArg = argument("now");
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--now must be an ISO date-time.");
  await runTrackedJob("macro:release-watch", { releaseId: releaseId ?? null, now: now.toISOString() }, async () => {
    const metrics = await watchMacroReleases(now, releaseId);
    return { result: undefined, metrics };
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
