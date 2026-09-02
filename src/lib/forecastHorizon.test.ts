import test from "node:test";
import assert from "node:assert/strict";
import { horizonTargetDate } from "./forecastHorizon";

const start = new Date("2026-03-15T00:00:00Z");
const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

test("canonical codes still resolve", () => {
  // A month is 30 days throughout, so 12M is 360 days rather than a calendar year.
  assert.equal(iso(horizonTargetDate(start, "3M")), "2026-06-13");
  assert.equal(iso(horizonTargetDate(start, "1W")), "2026-03-22");
  assert.equal(iso(horizonTargetDate(start, "12M")), "2027-03-10");
});

test("spelled-out durations resolve", () => {
  assert.equal(iso(horizonTargetDate(start, "1 week")), "2026-03-22");
  assert.equal(iso(horizonTargetDate(start, "12 months")), "2027-03-10");
  assert.equal(iso(horizonTargetDate(start, "1 year")), "2027-03-15");
});

test("a stated range settles at its midpoint", () => {
  // 3-6 months → 4.5 months → 135 days
  assert.equal(iso(horizonTargetDate(start, "3-6 months")), "2026-07-28");
  assert.equal(iso(horizonTargetDate(start, "next 8-10 weeks")), "2026-05-17");
});

test("qualitative bands map to the conventional readings", () => {
  assert.equal(iso(horizonTargetDate(start, "short_term")), "2026-04-14");
  assert.equal(iso(horizonTargetDate(start, "near-term")), "2026-04-14");
  assert.equal(iso(horizonTargetDate(start, "medium-term")), "2026-06-13");
  assert.equal(iso(horizonTargetDate(start, "long_term")), "2027-03-15");
  assert.equal(iso(horizonTargetDate(start, "strategic")), "2027-03-15");
});

test("absolute dates are taken as given, not as an offset", () => {
  assert.equal(iso(horizonTargetDate(start, "2026-12-31")), "2026-12-31");
  assert.equal(iso(horizonTargetDate(start, "2026-09")), "2026-09-30");
  assert.equal(iso(horizonTargetDate(start, "July 2026")), "2026-07-31");
  assert.equal(iso(horizonTargetDate(start, "2026年12月")), "2026-12-31");
});

test("quarters, halves and year-ends resolve to period ends", () => {
  assert.equal(iso(horizonTargetDate(start, "Q3 2026")), "2026-09-30");
  assert.equal(iso(horizonTargetDate(start, "H1 2027")), "2027-06-30");
  assert.equal(iso(horizonTargetDate(start, "2026H2")), "2026-12-31");
  assert.equal(iso(horizonTargetDate(start, "2026")), "2026-12-31");
  assert.equal(iso(horizonTargetDate(start, "end-2027")), "2027-12-31");
  assert.equal(iso(horizonTargetDate(start, "2026 year-end")), "2026-12-31");
  assert.equal(iso(horizonTargetDate(start, "year-end")), "2026-12-31");
});

test("a bare month name resolves to its next occurrence", () => {
  assert.equal(iso(horizonTargetDate(start, "September")), "2026-09-30");
  // Already past in the publication year, so it rolls forward.
  assert.equal(iso(horizonTargetDate(start, "January")), "2027-01-31");
});

test("a horizon that already expired at publication is not a forecast", () => {
  assert.equal(horizonTargetDate(start, "end of 2025"), null);
  assert.equal(horizonTargetDate(start, "2026-01-31"), null);
});

test("genuinely unspecified horizons stay null rather than being invented", () => {
  for (const horizon of ["coming quarters", "over time", "unknown", "not specified", "next months", "", null]) {
    assert.equal(horizonTargetDate(start, horizon), null, String(horizon));
  }
});

test("a parenthetical restatement does not defeat the qualitative match", () => {
  assert.equal(iso(horizonTargetDate(start, "medium-term (3-6 months)")), "2026-06-13");
});
