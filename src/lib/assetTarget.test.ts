import assert from "node:assert/strict";
import test from "node:test";
import { formatAssetTarget } from "./assetTarget";

test("asset targets use the canonical instrument unit", () => {
  assert.equal(formatAssetTarget("XAUUSD", 4500, "en"), "$4,500/oz");
  assert.equal(formatAssetTarget("WTI", 80, "zh-CN"), "$80/桶");
  assert.equal(formatAssetTarget("US10Y", 4.75, "en"), "4.75%");
  assert.equal(formatAssetTarget("EURUSD", 1.2, "en"), "1.2");
  assert.equal(formatAssetTarget("NDX", 25000, "en"), "25,000 points");
});
