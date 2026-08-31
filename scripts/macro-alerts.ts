import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { evaluateRules } from "../src/lib/alerts";

runTrackedJob("macro:alerts", {}, async () => {
  const fired = await evaluateRules();
  return { result: undefined, metrics: { fired } };
}).catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
