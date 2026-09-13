import assert from "node:assert/strict";
import test from "node:test";
import { latestEligibleExpectation } from "./expectations";

const target = { releaseId: "release", indicatorId: "cpi", referencePeriod: new Date("2026-08-01"), releaseStage: "INITIAL", unit: "PERCENT", seasonalAdjustment: "SA", scheduledAt: new Date("2026-09-10T12:30:00Z") };
const row = (overrides: Partial<Parameters<typeof latestEligibleExpectation>[0][number]> = {}) => ({ ...target, capturedAt: new Date("2026-09-10T12:00:00Z"), sourcePublishedAt: new Date("2026-09-10T11:00:00Z"), historicalReconstruction: false, ...overrides });

test("a post-release entry cannot become the frozen pre-release consensus", () => {
  assert.equal(latestEligibleExpectation([row({ capturedAt: new Date("2026-09-10T13:00:00Z") })], target), null);
});

test("reference period, unit and seasonal adjustment must all match", () => {
  assert.equal(latestEligibleExpectation([row({ referencePeriod: new Date("2026-07-01") }), row({ unit: "INDEX" }), row({ seasonalAdjustment: "NSA" })], target), null);
  assert.ok(latestEligibleExpectation([row()], target));
});

test("historical reconstruction is auditable but never impersonates a live snapshot", () => {
  assert.equal(latestEligibleExpectation([row({ historicalReconstruction: true })], target), null);
});
