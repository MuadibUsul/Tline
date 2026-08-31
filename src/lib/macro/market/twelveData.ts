import { normalizeDecimal } from "../normalize";
import { createJsonClient, requireApiKey, type ProviderOptions } from "../providers/types";
import type { MarketDataProvider, MarketQuality, MarketQuote } from "./types";

const ENDPOINT = "https://api.twelvedata.com";
const SYMBOLS: Record<string, string> = { EURUSD: "EUR/USD", GBPUSD: "GBP/USD", USDJPY: "USD/JPY", USDCHF: "USD/CHF", AUDUSD: "AUD/USD", USDCAD: "USD/CAD", XAUUSD: "XAU/USD" };

interface TwelveDataResponse {
  status?: string;
  code?: number;
  message?: string;
  symbol?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  interval?: string;
  meta?: { symbol?: string; interval?: string; currency?: string; type?: string };
  values?: Array<{ datetime?: string; open?: string; high?: string; low?: string; close?: string }>;
}

type TwelveValue = { datetime?: string; timestamp?: number; open?: string; high?: string; low?: string; close?: string };

function instant(value: { timestamp?: number; datetime?: string }) {
  const date = value.timestamp ? new Date(value.timestamp * 1000) : new Date(`${value.datetime?.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Twelve Data response has an invalid timestamp.");
  return date;
}

export function createTwelveDataProvider(options: ProviderOptions & { quality?: MarketQuality } = {}): MarketDataProvider {
  const requestJson = createJsonClient("twelve-data", { minIntervalMs: 500, ...options });
  const apiKey = () => requireApiKey("twelve_data", options.apiKey ?? process.env.TWELVE_DATA_API_KEY);
  const now = options.now ?? (() => new Date());
  const quality = options.quality ?? (process.env.TWELVE_DATA_QUALITY as MarketQuality | undefined) ?? "DELAYED";
  if (!(["DELAYED", "REALTIME", "EOD"] as MarketQuality[]).includes(quality)) throw new Error("Twelve Data quality must be DELAYED, REALTIME, or EOD.");
  const external = (symbol: string) => {
    const value = SYMBOLS[symbol.toUpperCase()];
    if (!value) throw new Error(`Unsupported market symbol ${symbol}.`);
    return value;
  };
  const mapped = (symbol: string, row: TwelveValue, meta: TwelveDataResponse["meta"], interval: string, fetchedAt: Date): MarketQuote => {
    const close = normalizeDecimal(row.close);
    if (!close) throw new Error("Twelve Data response has no close price.");
    return { symbol: symbol.toUpperCase(), provider: "twelve-data", externalSymbol: external(symbol), observedAt: instant(row), fetchedAt, interval, quoteCurrency: meta?.currency ?? symbol.toUpperCase().slice(3), quality, status: "PUBLISHED", open: normalizeDecimal(row.open), high: normalizeDecimal(row.high), low: normalizeDecimal(row.low), close, sourceUrl: "https://twelvedata.com/", metadata: { type: meta?.type ?? null } };
  };
  const getQuote = async (symbol: string) => {
      const fetchedAt = now();
      const url = new URL(`${ENDPOINT}/quote`); url.searchParams.set("symbol", external(symbol)); url.searchParams.set("timezone", "UTC"); url.searchParams.set("apikey", apiKey());
      const body = await requestJson<TwelveDataResponse>(url.href);
      if (body.status === "error") throw new Error(`Twelve Data rejected quote request (${body.code ?? "unknown"}).`);
      return mapped(symbol, body, { currency: body.currency, interval: body.interval }, body.interval ?? "quote", fetchedAt);
  };
  const getTimeSeries = async (symbol: string, interval: string, start: Date, end: Date) => {
      if (start > end) throw new Error("Market time-series start must not exceed end.");
      const fetchedAt = now();
      const url = new URL(`${ENDPOINT}/time_series`); url.searchParams.set("symbol", external(symbol)); url.searchParams.set("interval", interval); url.searchParams.set("start_date", start.toISOString()); url.searchParams.set("end_date", end.toISOString()); url.searchParams.set("timezone", "UTC"); url.searchParams.set("order", "ASC"); url.searchParams.set("apikey", apiKey());
      const body = await requestJson<TwelveDataResponse>(url.href);
      if (body.status === "error" || !Array.isArray(body.values)) throw new Error(`Twelve Data rejected time-series request (${body.code ?? "unknown"}).`);
      return body.values.map((row) => mapped(symbol, row, body.meta, body.meta?.interval ?? interval, fetchedAt));
  };
  return { id: "twelve-data", getQuote, getTimeSeries, healthCheck: async () => { await getQuote("EURUSD"); } };
}
