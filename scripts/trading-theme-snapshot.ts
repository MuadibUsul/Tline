import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { storeTradingThemeSnapshot } from "../src/lib/tradingThemeSnapshot";

runTrackedJob("macro:theme-snapshot", {}, async () => {
  const snapshot = await storeTradingThemeSnapshot();
  console.log(JSON.stringify({ event: "theme.snapshot.stored", id: snapshot.id }));
  return { result: undefined, metrics: { snapshotId: snapshot.id } };
}).catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
