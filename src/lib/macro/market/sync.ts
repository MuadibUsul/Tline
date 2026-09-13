import { prisma } from "../../db";
import { marketInstruments, storeMarketQuote, syncMarketInstruments } from "./provider";
import { createTwelveDataProvider } from "./twelveData";
import type { MarketDataProvider } from "./types";
import { reserveProviderBudget } from "./budget";
import { providerFailureReason } from "./quality";

type BudgetReserve = (provider: string, cost: number) => Promise<{ allowed: boolean; reason: string | null }>;

/**
 * Pull one quote per enabled instrument.
 *
 * The provider, the instrument table and the observation writer already existed but were
 * joined by nothing — `syncMarketInstruments` had no caller, so `storeMarketQuote` would
 * have rejected every quote with "unknown market instrument" even once a key was present.
 * This is the missing runtime path.
 */
export interface MarketSyncResult {
  configured: boolean;
  instruments: number;
  stored: number;
  failed: number;
  deferred: number;
  errors: string[];
  reason?: string;
}

export function resolveMarketProvider(): MarketDataProvider | null {
  // No key means the deployment has no market-data licence. That is a configuration
  // state, not a failure, and must not be reported as a broken job.
  if (!process.env.TWELVE_DATA_API_KEY) return null;
  return createTwelveDataProvider();
}

export async function syncMarketQuotes(
  provider: MarketDataProvider | null = resolveMarketProvider(),
  reserve: BudgetReserve = reserveProviderBudget,
): Promise<MarketSyncResult> {
  if (!provider) {
    return {
      configured: false,
      instruments: 0,
      stored: 0,
      failed: 0,
      deferred: 0,
      errors: [],
      reason: "no market-data provider configured (set TWELVE_DATA_API_KEY)",
    };
  }

  // Idempotent: instruments are a fixed definition list, upserted on every pass so a new
  // deployment does not need a separate seeding step.
  await syncMarketInstruments();

  const enabled = await prisma.marketInstrument.findMany({
    where: { enabled: true, symbol: { in: marketInstruments.map(([symbol]) => symbol) } },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });

  let stored = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];

  for (const { symbol } of enabled) {
    try {
      const budget = await reserve(provider.id, Math.max(1, Number(process.env.MARKET_QUOTE_ENDPOINT_WEIGHT || 1)));
      if (!budget.allowed) { deferred += 1; continue; }
      const quote = await provider.getQuote(symbol);
      await storeMarketQuote(quote);
      stored += 1;
    } catch (error) {
      // One rejected symbol must not abandon the rest of the sheet.
      failed += 1;
      if (errors.length < 5) errors.push(`${symbol} [${providerFailureReason(error)}]: ${String(error).slice(0, 160)}`);
    }
  }

  return { configured: true, instruments: enabled.length, stored, failed, deferred, errors };
}

/**
 * Pull a daily history rather than a single current quote.
 *
 * Settlement needs a level at the forecast date and another at the target date, which one
 * live quote per poll can never supply for a call made months ago. This backfills the
 * window once; the recurring quote sync keeps the near end fresh.
 */
export async function backfillMarketHistory(
  start: Date,
  end: Date = new Date(),
  provider: MarketDataProvider | null = resolveMarketProvider(),
  reserve: BudgetReserve = reserveProviderBudget,
  options: { instrumentLimit?: number; dryRun?: boolean } = {},
): Promise<MarketSyncResult> {
  if (!provider) {
    return {
      configured: false,
      instruments: 0,
      stored: 0,
      failed: 0,
      deferred: 0,
      errors: [],
      reason: "no market-data provider configured (set TWELVE_DATA_API_KEY)",
    };
  }
  await syncMarketInstruments();

  const enabled = await prisma.marketInstrument.findMany({
    where: { enabled: true, symbol: { in: marketInstruments.map(([symbol]) => symbol) } },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });
  const selected = enabled.slice(0, Math.max(0, options.instrumentLimit ?? enabled.length));
  if (options.dryRun) return { configured: true, instruments: selected.length, stored: 0, failed: 0, deferred: 0, errors: [], reason: `dry-run: ${selected.length} instrument(s), ${start.toISOString()}..${end.toISOString()}` };

  let stored = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];

  for (const { symbol } of selected) {
    try {
      const budget = await reserve(provider.id, Math.max(1, Number(process.env.MARKET_TIME_SERIES_ENDPOINT_WEIGHT || 1)));
      if (!budget.allowed) { deferred += 1; continue; }
      const quotes = await provider.getTimeSeries(symbol, "1day", start, end);
      for (const quote of quotes) {
        await storeMarketQuote(quote);
        stored += 1;
      }
    } catch (error) {
      failed += 1;
      if (errors.length < 5) errors.push(`${symbol} [${providerFailureReason(error)}]: ${String(error).slice(0, 160)}`);
    }
  }

  return { configured: true, instruments: selected.length, stored, failed, deferred, errors };
}
