import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { evaluateRules } from "../src/lib/alerts";
import { deliverPendingAlerts } from "../src/lib/alertDelivery";

// Firing and delivering run in the same pass: an alert that is only written to the table
// has not reached anyone, so the job is not done until delivery has been attempted.
runTrackedJob("macro:alerts", {}, async () => {
  const fired = await evaluateRules();
  const delivery = await deliverPendingAlerts();
  return { result: undefined, metrics: { fired, ...delivery } };
}).catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
