import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { syncFomcPolicyDocuments } from "../src/lib/macro/policy/fetch";

const sinceArg = process.argv.find((value) => value.startsWith("--since="))?.slice(8);
const since = sinceArg ? new Date(sinceArg) : undefined;
if (since && Number.isNaN(since.getTime())) throw new Error("--since must be an ISO date.");

runTrackedJob("macro:policy", { since: sinceArg ?? null }, async () => ({
  result: undefined,
  metrics: await syncFomcPolicyDocuments({ since }),
})).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
