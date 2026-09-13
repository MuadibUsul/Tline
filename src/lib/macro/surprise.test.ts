import assert from "node:assert/strict";
import test from "node:test";
import { buildMacroContext } from "./signal";
import { calculateSurprise, calculateSurpriseDetail, revisionMetrics, standardizeSurprise, surpriseDisplayUnit } from "./surprise";

test("surprise requires actual and legitimate consensus and never substitutes previous", () => {
  const result = calculateSurprise("3.2", "3.0");
  assert.equal(result.surpriseRaw?.toString(), "0.2");
  assert.equal(result.surprisePct?.toString(), "0.066666666666666666667");
  assert.deepEqual(calculateSurprise("3.2", null), { surpriseRaw: null, surprisePct: null });
  const zero = calculateSurprise("0.1", "0");
  assert.equal(zero.surpriseRaw?.toString(), "0.1");
  assert.equal(zero.surprisePct, null);
});

test("revision metrics retain initial, latest, count and all vintage IDs", () => {
  const metrics = revisionMetrics([
    { id: "v2", value: "101.5", revisionNo: 1, vintageAt: new Date("2026-02-01T00:00:00Z") },
    { id: "v1", value: "100", revisionNo: 0, vintageAt: new Date("2026-01-01T00:00:00Z") },
  ]);
  assert.equal(metrics?.initial.toString(), "100");
  assert.equal(metrics?.latest.toString(), "101.5");
  assert.equal(metrics?.revisionDelta.toString(), "1.5");
  assert.equal(metrics?.revisionPct?.toString(), "0.015");
  assert.equal(metrics?.revisionCount, 1);
  assert.deepEqual(metrics?.observationIds, ["v1", "v2"]);
});

test("macro context maps deterministic facts into four axes without an investment score", () => {
  const common = { value: "1", period: new Date("2026-01-01T00:00:00Z"), vintageAt: new Date("2026-02-01T00:00:00Z") };
  const context = buildMacroContext([
    { ...common, observationId: "labor", canonicalKey: "US_NFP", category: "LABOR" },
    { ...common, observationId: "inflation", canonicalKey: "US_CPI_HEADLINE", category: "INFLATION" },
    { ...common, observationId: "policy", canonicalKey: "ECB_DEPOSIT_RATE", category: "POLICY" },
    { ...common, observationId: "liquidity", canonicalKey: "US_EIA_CRUDE_INVENTORIES", category: "LIQUIDITY" },
  ]);
  assert.equal(context.axes.GROWTH[0].observationId, "labor");
  assert.equal(context.axes.INFLATION[0].observationId, "inflation");
  assert.equal(context.axes.POLICY[0].observationId, "policy");
  assert.equal(context.axes.LIQUIDITY[0].observationId, "liquidity");
  assert.equal("score" in context, false);
});

test("reports explicit missing-consensus reason and display units", () => {
  const result = calculateSurpriseDetail(3.2, null, "PERCENT");
  assert.equal(result.reason, "verified_consensus_missing");
  assert.equal(result.surpriseRaw, null);
  assert.equal(surpriseDisplayUnit("INDEX_POINTS"), "INDEX_POINTS");
});

test("standardization uses only supplied prior observations", () => {
  assert.equal(standardizeSurprise(2, [1, 2, 3]).reason, "insufficient_prior_samples");
  const result = standardizeSurprise(13, Array.from({ length: 12 }, (_, index) => index));
  assert.equal(result.reason, null);
  assert.ok((result.zScore ?? 0) > 1);
});
