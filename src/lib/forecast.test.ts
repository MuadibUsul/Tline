import assert from "node:assert/strict";
import test from "node:test";
import { calculateSettlement, targetDateForHorizon, wilsonInterval } from "./forecast";

test("maps supported forecast horizons without guessing unknown ones", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  assert.equal(targetDateForHorizon(start, "3M")?.toISOString(), "2026-04-01T00:00:00.000Z");
  assert.equal(targetDateForHorizon(start, null), null);
});

test("Wilson intervals apply only to directional proportions", () => {
  const interval = wilsonInterval(8, 10);
  assert.ok(interval && interval.low < 0.8 && interval.high > 0.8);
  assert.equal(wilsonInterval(0, 0), null);
});

test("calculates target error and directional correctness", () => {
  const result = calculateSettlement({ targetValue: 120, direction: 2, baseValue: 100, actualValue: 110 });
  assert.equal(result.absoluteError, 10);
  assert.ok(Math.abs(result.percentageError! - 8.3333333333) < 1e-6);
  assert.equal(result.directionCorrect, true);
  assert.equal(calculateSettlement({ targetValue: null, direction: 0, baseValue: 100, actualValue: 100.5 }).directionCorrect, true);
});
