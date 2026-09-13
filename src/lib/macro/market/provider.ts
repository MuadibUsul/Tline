import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { rawHash, stableStringify } from "../normalize";
import type { MarketQuote } from "./types";

export const marketInstruments = [
  ["EURUSD", "EUR", "USD", "FX", "EURUSD"], ["GBPUSD", "GBP", "USD", "FX", "GBPUSD"], ["USDJPY", "USD", "JPY", "FX", "USDJPY"],
  ["USDCHF", "USD", "CHF", "FX", null], ["AUDUSD", "AUD", "USD", "FX", null], ["USDCAD", "USD", "CAD", "FX", null],
  ["XAUUSD", "XAU", "USD", "COMMODITY", "XAUUSD"],
] as const;

export function isVerifiedMarketMapping(
  instrument: { id: string; quoteCurrency: string },
  source: { instrumentId: string } | null,
  quote: Pick<MarketQuote, "quoteCurrency">,
) {
  return Boolean(source && source.instrumentId === instrument.id && instrument.quoteCurrency === quote.quoteCurrency);
}

export async function syncMarketInstruments() {
  for (const [symbol, baseAsset, quoteCurrency, assetClass, assetTicker] of marketInstruments) {
    const asset = assetTicker ? await prisma.asset.findUnique({ where: { ticker: assetTicker }, select: { id: true } }) : null;
    const instrument = await prisma.marketInstrument.upsert({
      where: { symbol },
      create: { symbol, assetId: asset?.id, baseAsset, quoteCurrency, assetClass, instrumentType: "SPOT", priceType: "LAST", unit: "PRICE", timezone: "UTC" },
      update: { assetId: asset?.id, baseAsset, quoteCurrency, assetClass, instrumentType: "SPOT", priceType: "LAST", unit: "PRICE", timezone: "UTC", enabled: true },
    });
    await prisma.marketInstrumentSource.upsert({
      where: { provider_externalSymbol: { provider: "twelve-data", externalSymbol: `${baseAsset}/${quoteCurrency}` } },
      create: { instrumentId: instrument.id, provider: "twelve-data", externalSymbol: `${baseAsset}/${quoteCurrency}`, quoteCurrency, licenseKey: "twelve-data:market" },
      update: { instrumentId: instrument.id, quoteCurrency, licenseKey: "twelve-data:market", enabled: true },
    });
  }
}

export async function storeMarketQuote(quote: MarketQuote) {
  const instrument = await prisma.marketInstrument.findUnique({ where: { symbol: quote.symbol }, select: { id: true, quoteCurrency: true } });
  if (!instrument) throw new Error(`Unknown or mismatched market instrument ${quote.symbol}.`);
  const source = await prisma.marketInstrumentSource.findUnique({ where: { provider_externalSymbol: { provider: quote.provider, externalSymbol: quote.externalSymbol } }, select: { instrumentId: true } });
  if (!isVerifiedMarketMapping(instrument, source, quote)) throw new Error(`Unverified or mismatched provider mapping ${quote.provider}:${quote.externalSymbol}.`);
  return prisma.marketObservation.upsert({
    where: { provider_externalSymbol_observedAt_interval: { provider: quote.provider, externalSymbol: quote.externalSymbol, observedAt: quote.observedAt, interval: quote.interval } },
    create: {
      instrumentId: instrument.id, provider: quote.provider, externalSymbol: quote.externalSymbol, observedAt: quote.observedAt,
      fetchedAt: quote.fetchedAt, interval: quote.interval, quoteCurrency: quote.quoteCurrency, quality: quote.quality, status: quote.status,
      providerUpdatedAt: quote.providerUpdatedAt, providerDelaySeconds: quote.providerDelaySeconds, marketState: quote.marketState,
      priceType: quote.priceType, unit: quote.unit, licenseKey: quote.licenseKey,
      open: quote.open ? new Prisma.Decimal(quote.open) : null, high: quote.high ? new Prisma.Decimal(quote.high) : null,
      low: quote.low ? new Prisma.Decimal(quote.low) : null, close: new Prisma.Decimal(quote.close), sourceUrl: quote.sourceUrl,
      rawHash: rawHash(quote.metadata ?? {}), metadata: quote.metadata ? stableStringify(quote.metadata) : null,
    },
    update: {},
  });
}
