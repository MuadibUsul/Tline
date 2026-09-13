import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runTrackedJob } from "../src/lib/jobs";
import { backfillMarketHistory, syncMarketQuotes } from "../src/lib/macro/market/sync";

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const backfillFrom = arg("from");
const backfillTo = arg("to");
const instrumentLimit = arg("limit");
const dryRun = process.argv.includes("--dry-run");

runTrackedJob("macro:market", {}, async () => {
  // --from=YYYY-MM-DD pulls a daily history for settlement; the default pass takes one
  // current quote per instrument.
  const result = backfillFrom
    ? await backfillMarketHistory(new Date(`${backfillFrom}T00:00:00Z`), backfillTo ? new Date(`${backfillTo}T23:59:59Z`) : new Date(), undefined, undefined, { instrumentLimit: instrumentLimit ? Math.max(0, Number(instrumentLimit)) : undefined, dryRun })
    : await syncMarketQuotes();
  if (!result.configured) console.log(`market sync skipped: ${result.reason}`);
  else console.log(`market sync: ${result.stored} stored · ${result.failed} failed of ${result.instruments} instruments`);
  for (const error of result.errors) console.error(`  ${error}`);
  return { result: undefined, metrics: { ...result, errors: result.errors.length } };
}).catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
