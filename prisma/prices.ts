import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";

function arg(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const file = arg("file");
  const source = arg("source");
  if (!file || !source) throw new Error("Usage: npm run prices:import -- --file=prices.csv --source=licensed-provider");
  const absolute = path.resolve(file);
  const lines = (await readFile(absolute, "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift()?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  const tickerIndex = headers.indexOf("ticker");
  const timestampIndex = headers.indexOf("timestamp");
  const valueIndex = headers.indexOf("value");
  if ([tickerIndex, timestampIndex, valueIndex].includes(-1)) throw new Error("CSV headers must include ticker,timestamp,value.");

  const assets = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  const byTicker = new Map(assets.map((asset) => [asset.ticker.toUpperCase(), asset.id]));
  let imported = 0;
  let rejected = 0;
  for (const line of lines) {
    const columns = line.split(",").map((value) => value.trim());
    const assetId = byTicker.get((columns[tickerIndex] || "").toUpperCase());
    const timestamp = new Date(columns[timestampIndex]);
    const value = Number(columns[valueIndex]);
    if (!assetId || Number.isNaN(timestamp.getTime()) || !Number.isFinite(value) || value <= 0) {
      rejected++;
      continue;
    }
    await prisma.priceObservation.upsert({
      where: { assetId_timestamp_source: { assetId, timestamp, source } },
      create: { assetId, timestamp, value, source, sourceRef: path.basename(absolute) },
      update: { value, sourceRef: path.basename(absolute) },
    });
    imported++;
  }
  console.log(`Prices: ${imported} imported · ${rejected} rejected · source ${source}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
