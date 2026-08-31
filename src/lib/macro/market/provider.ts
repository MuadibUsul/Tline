import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { rawHash, stableStringify } from "../normalize";
import type { MarketQuote } from "./types";

export const marketInstruments = [
  ["EURUSD", "EUR", "USD", "FX"], ["GBPUSD", "GBP", "USD", "FX"], ["USDJPY", "USD", "JPY", "FX"],
  ["USDCHF", "USD", "CHF", "FX"], ["AUDUSD", "AUD", "USD", "FX"], ["USDCAD", "USD", "CAD", "FX"],
  ["XAUUSD", "XAU", "USD", "COMMODITY"],
] as const;

export async function syncMarketInstruments() {
  for (const [symbol, baseAsset, quoteCurrency, assetClass] of marketInstruments) {
    await prisma.marketInstrument.upsert({ where: { symbol }, create: { symbol, baseAsset, quoteCurrency, assetClass }, update: { baseAsset, quoteCurrency, assetClass, enabled: true } });
  }
}

export async function storeMarketQuote(quote: MarketQuote) {
  const instrument = await prisma.marketInstrument.findUnique({ where: { symbol: quote.symbol }, select: { id: true, quoteCurrency: true } });
  if (!instrument || instrument.quoteCurrency !== quote.quoteCurrency) throw new Error(`Unknown or mismatched market instrument ${quote.symbol}.`);
  return prisma.marketObservation.upsert({
    where: { provider_externalSymbol_observedAt_interval: { provider: quote.provider, externalSymbol: quote.externalSymbol, observedAt: quote.observedAt, interval: quote.interval } },
    create: {
      instrumentId: instrument.id, provider: quote.provider, externalSymbol: quote.externalSymbol, observedAt: quote.observedAt,
      fetchedAt: quote.fetchedAt, interval: quote.interval, quoteCurrency: quote.quoteCurrency, quality: quote.quality, status: quote.status,
      open: quote.open ? new Prisma.Decimal(quote.open) : null, high: quote.high ? new Prisma.Decimal(quote.high) : null,
      low: quote.low ? new Prisma.Decimal(quote.low) : null, close: new Prisma.Decimal(quote.close), sourceUrl: quote.sourceUrl,
      rawHash: rawHash(quote.metadata ?? {}), metadata: quote.metadata ? stableStringify(quote.metadata) : null,
    },
    update: {},
  });
}
