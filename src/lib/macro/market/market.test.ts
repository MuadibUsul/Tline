import assert from "node:assert/strict";
import test from "node:test";
import { createTwelveDataProvider } from "./twelveData";

test("Twelve Data quote maps FX metadata and defaults conservatively to delayed", async () => {
  let requested = "";
  const provider = createTwelveDataProvider({ apiKey: "test-secret", now: () => new Date("2026-08-29T12:01:00Z"), fetch: async (input) => {
    requested = String(input);
    return Response.json({ symbol: "EUR/USD", currency: "USD", timestamp: 1788004800, interval: "1min", open: "1.1600", high: "1.1620", low: "1.1590", close: "1.1610" });
  } });
  const quote = await provider.getQuote("EURUSD");
  assert.match(requested, /symbol=EUR%2FUSD/);
  assert.equal(quote.provider, "twelve-data");
  assert.equal(quote.externalSymbol, "EUR/USD");
  assert.equal(quote.quoteCurrency, "USD");
  assert.equal(quote.quality, "DELAYED");
  assert.equal(quote.close, "1.161");
});

test("Twelve Data historical rows preserve interval and UTC observation timestamps", async () => {
  const provider = createTwelveDataProvider({ apiKey: "test-secret", quality: "EOD", now: () => new Date("2026-08-29T12:01:00Z"), fetch: async () => Response.json({
    status: "ok",
    meta: { symbol: "XAU/USD", interval: "1day", currency: "USD", type: "Physical Currency" },
    values: [{ datetime: "2026-08-28 00:00:00", open: "3400", high: "3420", low: "3390", close: "3410" }],
  }) });
  const rows = await provider.getTimeSeries("XAUUSD", "1day", new Date("2026-08-01T00:00:00Z"), new Date("2026-08-29T00:00:00Z"));
  assert.equal(rows[0].symbol, "XAUUSD");
  assert.equal(rows[0].interval, "1day");
  assert.equal(rows[0].quality, "EOD");
  assert.equal(rows[0].observedAt.toISOString(), "2026-08-28T00:00:00.000Z");
});

test("ECB-style official reference quality cannot be assigned to Twelve Data", () => {
  assert.throws(() => createTwelveDataProvider({ apiKey: "test-secret", quality: "OFFICIAL_REFERENCE" }), /quality/);
});
