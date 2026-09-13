import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMarketUse, marketFreshnessSeconds, providerFailureReason } from "./quality";

const license = { status: "CONFIRMED", allowedUses: '["public_display"]', confirmedAt: new Date("2026-09-01"), expiresAt: null };

test("provider delay, sampling cadence and market closure remain distinct", () => {
  assert.equal(marketFreshnessSeconds("1min", 1800, 900, "OPEN"), 5400);
  assert.equal(marketFreshnessSeconds("1day", 1800, 0, "CLOSED"), 4 * 86400);
});

test("unknown authorization denies server-side use and a closed daily market is not immediately stale", () => {
  const common = { observedAt: new Date("2026-09-11T21:00:00Z"), fetchedAt: new Date("2026-09-11T21:01:00Z"), interval: "1day", status: "PUBLISHED", marketState: "CLOSED", providerDelaySeconds: 900, samplingIntervalSeconds: 1800 };
  assert.equal(evaluateMarketUse({ ...common, license: null }, "public_display", new Date("2026-09-13T00:00:00Z")).reason, "authorization_pending");
  assert.equal(evaluateMarketUse({ ...common, license }, "public_display", new Date("2026-09-13T00:00:00Z")).usable, true);
});

test("authorization is purpose-specific and provider failures keep actionable reasons", () => {
  const decision = evaluateMarketUse({ observedAt: new Date(), fetchedAt: new Date(), interval: "quote", status: "PUBLISHED", marketState: "OPEN", providerDelaySeconds: 0, samplingIntervalSeconds: 60, license }, "social");
  assert.equal(decision.reason, "permission_denied");
  assert.equal(providerFailureReason({ status: 429 }), "quota_exhausted");
  assert.equal(providerFailureReason({ status: 403 }), "permission_denied");
});
