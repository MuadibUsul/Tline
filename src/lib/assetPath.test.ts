import assert from "node:assert/strict";
import test from "node:test";
import { assetPath, canonicalAssetRedirectPath, isPublicAssetTicker, legacyNonAssetRedirectPath, legacyTopicRedirectPath, tickerFromAssetSlug } from "./assetPath";

test("high-value assets use readable stable paths and resolve back to tickers", () => {
  assert.equal(assetPath("XAUUSD"), "/markets/gold");
  assert.equal(tickerFromAssetSlug("gold"), "XAUUSD");
  assert.equal(assetPath("AAPL"), "/markets/aapl");
  assert.equal(tickerFromAssetSlug("aapl"), "AAPL");
});

test("legacy asset-shaped topics resolve to one canonical public page", () => {
  assert.equal(legacyTopicRedirectPath("gold"), "/markets/gold");
  assert.equal(legacyTopicRedirectPath("us-dollar-dxy"), "/markets/us-dollar-index");
  assert.equal(legacyTopicRedirectPath("s-p-500"), "/markets/sp-500");
  assert.equal(legacyTopicRedirectPath("fed-policy"), "/institution/federal-reserve");
  assert.equal(legacyTopicRedirectPath("inflation"), null);
});

test("legacy pseudo-assets resolve to their replacement facet", () => {
  assert.equal(legacyNonAssetRedirectPath("FED"), "/institution/federal-reserve");
  assert.equal(legacyNonAssetRedirectPath("CPI"), "/topics/inflation");
  assert.equal(legacyNonAssetRedirectPath("SPX"), null);
  assert.equal(isPublicAssetTicker("CPI"), false);
  assert.equal(isPublicAssetTicker("FED"), false);
  assert.equal(isPublicAssetTicker("SPX"), true);
});

test("ticker and case aliases redirect once to the readable asset URL", () => {
  assert.equal(canonicalAssetRedirectPath("SPX", "SPX"), "/markets/sp-500");
  assert.equal(canonicalAssetRedirectPath("spx", "SPX"), "/markets/sp-500");
  assert.equal(canonicalAssetRedirectPath("sp-500", "SPX"), null);
  assert.equal(canonicalAssetRedirectPath("AAPL", "AAPL"), "/markets/aapl");
  assert.equal(canonicalAssetRedirectPath("aapl", "AAPL"), null);
});
