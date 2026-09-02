import { prisma } from "../db";

/**
 * Feed `PriceObservation` from the two observation tables the pipeline already fills.
 *
 * Forecast settlement reads only `PriceObservation`, while the macro sync writes
 * `MacroObservation` and the market sync writes `MarketObservation`. Nothing joined them,
 * so the settlement table stayed empty no matter how much data arrived. This is that join.
 *
 * Settlement matches a base and an actual observation from the SAME `source`, so each
 * series writes one stable source name and never mixes providers for one asset.
 */

/**
 * Macro series that are genuinely prices of a tradeable asset. Most macro series are not:
 * a CPI index or an unemployment rate is not the price of anything, and putting one here
 * would produce a settlement figure with no meaning.
 */
export const MACRO_PRICE_SERIES: Array<{ externalSeriesId: string; ticker: string; source: string }> = [
  { externalSeriesId: "DCOILWTICO", ticker: "WTI", source: "fred:DCOILWTICO" },
];

/** Market instruments that correspond to a tracked asset. Unmapped symbols are skipped. */
export const MARKET_PRICE_SYMBOLS: Array<{ symbol: string; ticker: string }> = [
  { symbol: "XAUUSD", ticker: "XAUUSD" },
  { symbol: "EURUSD", ticker: "EURUSD" },
  { symbol: "GBPUSD", ticker: "GBPUSD" },
  { symbol: "USDJPY", ticker: "USDJPY" },
];

const MARKET_SOURCE = "twelve-data";

export interface PriceBridgeResult {
  fromMacro: number;
  fromMarket: number;
  skipped: string[];
}

async function tickerIds(): Promise<Map<string, string>> {
  const assets = await prisma.asset.findMany({ select: { id: true, ticker: true } });
  return new Map(assets.map((asset) => [asset.ticker.toUpperCase(), asset.id]));
}

/** Latest revision of each period. Earlier vintages are history, not the current value. */
async function bridgeMacro(assetIds: Map<string, string>, skipped: string[]): Promise<number> {
  let written = 0;
  for (const { externalSeriesId, ticker, source } of MACRO_PRICE_SERIES) {
    const assetId = assetIds.get(ticker.toUpperCase());
    if (!assetId) { skipped.push(`${ticker}: no matching asset`); continue; }
    const series = await prisma.macroSeriesSource.findFirst({
      where: { externalSeriesId },
      select: { id: true },
    });
    if (!series) { skipped.push(`${externalSeriesId}: series not registered`); continue; }

    const observations = await prisma.macroObservation.findMany({
      where: { seriesSourceId: series.id, status: "PUBLISHED" },
      orderBy: [{ period: "asc" }, { revisionNo: "desc" }],
      select: { period: true, value: true, revisionNo: true },
    });

    const latestByPeriod = new Map<number, number>();
    for (const observation of observations) {
      const key = observation.period.getTime();
      if (latestByPeriod.has(key)) continue; // revisionNo desc: the first row wins
      const value = Number(observation.value);
      if (!Number.isFinite(value) || value <= 0) continue;
      latestByPeriod.set(key, value);
    }

    for (const [period, value] of latestByPeriod) {
      const timestamp = new Date(period);
      await prisma.priceObservation.upsert({
        where: { assetId_timestamp_source: { assetId, timestamp, source } },
        create: { assetId, timestamp, value, source, sourceRef: externalSeriesId },
        update: { value, sourceRef: externalSeriesId },
      });
      written += 1;
    }
  }
  return written;
}

/**
 * One price per UTC day, taken from the last quote observed that day. The market sync polls
 * intraday, and settlement compares end-of-day levels rather than whichever tick happened
 * to be stored.
 */
async function bridgeMarket(assetIds: Map<string, string>, skipped: string[]): Promise<number> {
  let written = 0;
  for (const { symbol, ticker } of MARKET_PRICE_SYMBOLS) {
    const assetId = assetIds.get(ticker.toUpperCase());
    if (!assetId) { skipped.push(`${ticker}: no matching asset`); continue; }
    const instrument = await prisma.marketInstrument.findUnique({
      where: { symbol },
      select: { id: true },
    });
    if (!instrument) continue; // instruments appear only once a provider key is configured

    const observations = await prisma.marketObservation.findMany({
      where: { instrumentId: instrument.id, status: "PUBLISHED" },
      orderBy: { observedAt: "asc" },
      select: { observedAt: true, close: true },
    });

    const lastOfDay = new Map<string, { observedAt: Date; value: number }>();
    for (const observation of observations) {
      const value = Number(observation.close);
      if (!Number.isFinite(value) || value <= 0) continue;
      lastOfDay.set(observation.observedAt.toISOString().slice(0, 10), { observedAt: observation.observedAt, value });
    }

    for (const { observedAt, value } of lastOfDay.values()) {
      await prisma.priceObservation.upsert({
        where: { assetId_timestamp_source: { assetId, timestamp: observedAt, source: MARKET_SOURCE } },
        create: { assetId, timestamp: observedAt, value, source: MARKET_SOURCE, sourceRef: symbol },
        update: { value, sourceRef: symbol },
      });
      written += 1;
    }
  }
  return written;
}

export async function syncPriceObservations(): Promise<PriceBridgeResult> {
  const assetIds = await tickerIds();
  const skipped: string[] = [];
  const fromMacro = await bridgeMacro(assetIds, skipped);
  const fromMarket = await bridgeMarket(assetIds, skipped);
  return { fromMacro, fromMarket, skipped };
}
