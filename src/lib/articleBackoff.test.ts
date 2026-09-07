import assert from "node:assert/strict";
import test from "node:test";
import { backoffDelayMs, dueFilter, MAX_FAILURES } from "./articleBackoff";

test("backoff grows exponentially from the first failure and is capped", () => {
  assert.equal(backoffDelayMs(0), 0);
  const first = backoffDelayMs(1);
  assert.equal(backoffDelayMs(2), first * 2);
  assert.equal(backoffDelayMs(3), first * 4);
  // Capped, or a long-broken article would schedule its next attempt years out.
  assert.equal(backoffDelayMs(40), backoffDelayMs(41));
  assert.equal(backoffDelayMs(40) <= 24 * 60 * 60_000, true);
});

test("the due filter excludes abandoned articles and those inside their window", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const filter = dueFilter("translation", now) as Record<string, unknown>;
  assert.deepEqual(filter.translationFailCount, { lt: MAX_FAILURES });
  assert.deepEqual(filter.OR, [
    { translationNextAttemptAt: null },
    { translationNextAttemptAt: { lte: now } },
  ]);
});

test("each pipeline reads its own columns so one cannot stall the other", () => {
  const analysis = Object.keys(dueFilter("analysis")).join(" ") + JSON.stringify(dueFilter("analysis"));
  assert.match(analysis, /analysisFailCount/);
  assert.doesNotMatch(analysis, /translationFailCount/);
});
