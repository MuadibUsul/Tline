import assert from "node:assert/strict";
import test from "node:test";
import { assetPath, tickerFromAssetSlug } from "./assetPath";

test("high-value assets use readable stable paths and resolve back to tickers", () => {
  assert.equal(assetPath("XAUUSD"), "/markets/gold");
  assert.equal(tickerFromAssetSlug("gold"), "XAUUSD");
  assert.equal(assetPath("AAPL"), "/markets/aapl");
  assert.equal(tickerFromAssetSlug("aapl"), "AAPL");
});
