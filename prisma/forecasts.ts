import "dotenv/config";
import { prisma } from "../src/lib/db";
import { settleDueForecasts, syncAllForecasts } from "../src/lib/forecast";

async function main() {
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
