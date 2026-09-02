import test from "node:test";
import assert from "node:assert/strict";
import { MACRO_PRICE_SERIES, MARKET_PRICE_SYMBOLS } from "./bridge";
import { ASSETS } from "../assets";
import { marketInstruments } from "../macro/market/provider";
import { macroSources } from "../macro/registry";
import { SETTLEABLE_ASSET_CLASSES } from "../forecast";

const tickers = new Set(ASSETS.map((asset) => asset.ticker));
const assetClass = new Map(ASSETS.map((asset) => [asset.ticker, asset.assetClass]));

test("every bridged macro series maps to a real asset", () => {
  for (const entry of MACRO_PRICE_SERIES) {
    assert.ok(tickers.has(entry.ticker), `unknown ticker ${entry.ticker}`);
  }
});

test("every bridged macro series is actually registered with a provider", () => {
  const registered = new Set(macroSources.map((source) => source.externalSeriesId));
  for (const entry of MACRO_PRICE_SERIES) {
    assert.ok(registered.has(entry.externalSeriesId), `${entry.externalSeriesId} is not in sources.json`);
  }
});

test("every bridged market symbol exists as an instrument and as an asset", () => {
  // marketInstruments is `as const`, so widen to string before membership testing.
  const symbols = new Set<string>(marketInstruments.map(([symbol]) => symbol));
  for (const entry of MARKET_PRICE_SYMBOLS) {
    assert.ok(symbols.has(entry.symbol), `${entry.symbol} is not a defined instrument`);
    assert.ok(tickers.has(entry.ticker), `unknown ticker ${entry.ticker}`);
  }
});

test("nothing is bridged into an asset class that settlement refuses to score", () => {
  // Bridging a price for a rate or macro asset would create observations that settlement
  // deliberately ignores — dead data that looks like coverage.
  const settleable = new Set<string>(SETTLEABLE_ASSET_CLASSES);
  for (const entry of [...MACRO_PRICE_SERIES, ...MARKET_PRICE_SYMBOLS]) {
    const cls = assetClass.get(entry.ticker);
    assert.ok(cls && settleable.has(cls), `${entry.ticker} is ${cls}, which is not settleable`);
  }
});

test("each asset draws its prices from exactly one source", () => {
  // Settlement matches a base and an actual from the SAME source. Two sources feeding one
  // asset would let a base come from one provider and the actual from another.
  const seen = new Map<string, string>();
  for (const entry of MACRO_PRICE_SERIES) seen.set(entry.ticker, entry.source);
  for (const entry of MARKET_PRICE_SYMBOLS) {
    assert.equal(seen.get(entry.ticker), undefined, `${entry.ticker} is bridged from two sources`);
    seen.set(entry.ticker, "twelve-data");
  }
});
