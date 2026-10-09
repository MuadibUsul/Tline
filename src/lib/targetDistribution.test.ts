import assert from "node:assert/strict";
import test from "node:test";
import { buildTargetDistribution } from "./targetDistribution";

test("does not call one institution or undated targets a distribution", () => {
  assert.equal(buildTargetDistribution([{ institutionId: "a", target: 5000, timeHorizon: "year-end 2027" }]), null);
  assert.equal(buildTargetDistribution([
    { institutionId: "a", target: 5000, timeHorizon: null },
    { institutionId: "b", target: 5200, timeHorizon: "year-end 2027" },
  ]), null);
});

test("computes a distribution from distinct institutions with dated targets", () => {
  assert.deepEqual(buildTargetDistribution([
    { institutionId: "a", target: 4800, timeHorizon: "year-end 2027" },
    { institutionId: "b", target: 5200, timeHorizon: "12M" },
  ]), { low: 4800, high: 5200, median: 5200, avg: 5000 });
});
