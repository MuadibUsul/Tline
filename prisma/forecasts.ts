import "dotenv/config";
import { prisma } from "../src/lib/db";
import { settleDueForecasts, syncAllForecasts } from "../src/lib/forecast";
import { syncPriceObservations } from "../src/lib/prices/bridge";

async function main() {
  // Prices first: settlement reads only PriceObservation, which the macro and market syncs
  // do not write to directly.
  const prices = await syncPriceObservations();
  console.log(`Prices: ${prices.fromMacro} from macro series · ${prices.fromMarket} from market quotes.`);
  for (const note of prices.skipped) console.log(`  skipped ${note}`);

  const synced = await syncAllForecasts();
  const result = await settleDueForecasts();
  console.log(`Forecasts: ${synced} signals synced · ${result.settled}/${result.due} due forecasts settled.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
