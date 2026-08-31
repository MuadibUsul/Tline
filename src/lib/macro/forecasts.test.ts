import assert from "node:assert/strict";
import test from "node:test";
import { aggregateForecasts, normalizeIndicator, parseReferencePeriod } from "./forecasts";

test("normalizes free-text indicator names to canonical keys", () => {
  assert.equal(normalizeIndicator("Nonfarm payrolls"), "US_NFP");
  assert.equal(normalizeIndicator("非农就业"), "US_NFP");
  assert.equal(normalizeIndicator("the unemployment rate"), "US_UNEMPLOYMENT_RATE");
  assert.equal(normalizeIndicator("core CPI"), "US_CPI_CORE");
  assert.equal(normalizeIndicator("headline CPI"), "US_CPI_HEADLINE");
  assert.equal(normalizeIndicator("job openings (JOLTS)"), "US_JOLTS_OPENINGS");
  assert.equal(normalizeIndicator("Q2 GDP"), "US_GDP");
  assert.equal(normalizeIndicator("something unrelated"), null);
});

test("parses reference periods to the first day of the period", () => {
  assert.equal(parseReferencePeriod("August 2026")?.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(parseReferencePeriod("Aug 2026")?.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(parseReferencePeriod("Q2 2026")?.toISOString().slice(0, 10), "2026-04-01");
  assert.equal(parseReferencePeriod("2026-08")?.toISOString().slice(0, 10), "2026-08-01");
  assert.equal(parseReferencePeriod("no period here", 2026), null);
});

test("aggregates institution forecasts into consensus and distribution", () => {
  const consensus = aggregateForecasts([
    { institution: "RBC", value: 16, unit: "thousands" },
    { institution: "UBS", value: 20, unit: "thousands" },
    { institution: "CommBank", value: 24, unit: "thousands" },
  ]);
  assert.equal(consensus.count, 3);
  assert.equal(consensus.median, 20);
  assert.equal(consensus.min, 16);
  assert.equal(consensus.max, 24);
  assert.equal(consensus.unit, "thousands");
  assert.deepEqual(consensus.contributors.map((c) => c.institution), ["CommBank", "UBS", "RBC"]);
  assert.equal(aggregateForecasts([]).median, null);
});
