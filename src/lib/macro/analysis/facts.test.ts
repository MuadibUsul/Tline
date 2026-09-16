import assert from "node:assert/strict";
import test from "node:test";
import { buildFacts, momentumFor, periodChanges, type FactInput } from "./facts";
import { fallbackReadOut, readOutViolations, unsupportedNumbers, type ReadOut } from "./guard";

const playbook = { family: "FOMC_DECISION", topic: "policy stance", primary: "US_FED_FUNDS_TARGET_UPPER", metrics: [], compare: [], market: [], questions: [], notes: "" };

const rateSeries = [
  { period: new Date("2025-12-16"), value: 3.5 },
  { period: new Date("2026-03-18"), value: 3.5 },
  { period: new Date("2026-06-17"), value: 3.5 },
  { period: new Date("2026-07-29"), value: 3.75 },
];

const input = (over: Partial<FactInput> = {}): FactInput => ({
  family: "FOMC_DECISION",
  title: "FOMC Policy Decision",
  now: new Date("2026-09-16T18:02:00.000Z"),
  playbook,
  values: [{ canonicalKey: "US_FED_FUNDS_TARGET_UPPER", nameEn: "Federal Funds Target Range — Upper Limit", nameZh: "联邦基金目标区间上限", unit: "PERCENT", actual: 4, consensus: 4, previous: 3.75 }],
  history: { US_FED_FUNDS_TARGET_UPPER: rateSeries },
  ...over,
});

test("the print is set against its previous value, consensus and the recorded distribution", () => {
  const facts = buildFacts(input());
  assert.equal(facts.values.length, 1);
  const value = facts.values[0];
  assert.equal(value.change, 0.25);
  assert.equal(value.surprise, 0);
  assert.equal(value.surpriseSd, 0);
  assert.equal(value.momentum, 0.5);
  assert.equal(value.momentumLabel, "change over three periods");
});

test("conclusions are labelled from the arithmetic, not left to prose", () => {
  const facts = buildFacts(input());
  assert.ok(facts.labels.some((label) => label.includes("printed exactly at the consensus of 4")));
  assert.ok(facts.labels.some((label) => label.includes("rose 0.25 from 3.75 to 4")));
  const withoutConsensus = buildFacts(input({ values: [{ canonicalKey: "US_FED_FUNDS_TARGET_UPPER", nameEn: "Upper", nameZh: null, unit: "PERCENT", actual: 4, consensus: null, previous: 3.75 }] }));
  assert.ok(withoutConsensus.labels.some((label) => label.includes("cannot be described as beating or missing expectations")));
});

test("a surprise is expressed against the spread of past changes", () => {
  // A noisy history, because a perfectly linear series has a spread of zero and the
  // standardised surprise is then undefined rather than infinite.
  const steps = [1, 0.8, 1.3, 0.9, 1.1, 1.4, 0.7, 1.2, 1, 0.9, 1.3, 1.1];
  let level = 100;
  const history = steps.map((step, index) => { level += step; return { period: new Date(Date.UTC(2024, index, 1)), value: level }; });
  const facts = buildFacts(input({
    values: [{ canonicalKey: "US_CPI_HEADLINE", nameEn: "CPI", nameZh: null, unit: "INDEX", actual: 130, consensus: 129.5, previous: 129.4 }],
    history: { US_CPI_HEADLINE: history },
  }));
  const value = facts.values[0];
  assert.equal(value.surprise, 0.5);
  assert.equal(value.changePercentile, 0);
  assert.ok(value.surpriseSd !== null && value.surpriseSd > 0);
  assert.equal(value.momentumLabel, "three-month annualised");
});

test("an index change is annualised, a flow change is averaged, a rate change is reported as a change", () => {
  const index = [{ period: new Date(Date.UTC(2026, 5, 1)), value: 100 }, { period: new Date(Date.UTC(2026, 6, 1)), value: 100.3 }, { period: new Date(Date.UTC(2026, 7, 1)), value: 100.6 }, { period: new Date(Date.UTC(2026, 8, 1)), value: 100.9 }];
  const annualised = momentumFor("INDEX", index);
  assert.equal(annualised.label, "three-month annualised");
  assert.ok(annualised.value! > 3 && annualised.value! < 4);
  const payrolls = [{ period: new Date(Date.UTC(2026, 5, 1)), value: 1000 }, { period: new Date(Date.UTC(2026, 6, 1)), value: 1010 }, { period: new Date(Date.UTC(2026, 7, 1)), value: 1030 }, { period: new Date(Date.UTC(2026, 8, 1)), value: 1040 }];
  assert.equal(momentumFor("THOUSANDS_OF_PERSONS", payrolls).value, 13.33);
  assert.equal(momentumFor("PERCENT", rateSeries).value, 0.25);
  assert.equal(momentumFor("INDEX", index.slice(0, 2)).value, null);
});

test("period changes are consecutive differences in period order", () => {
  assert.deepEqual(periodChanges([{ period: new Date("2026-02-01"), value: 5 }, { period: new Date("2026-01-01"), value: 3 }, { period: new Date("2026-03-01"), value: 9 }]), [2, 4]);
});

const readOut = (over: Partial<ReadOut> = {}): ReadOut => ({
  headline: "The Fed raised the target range by 25bp to 4%, as expected.",
  read: "The committee lifted the upper bound of the target range to 4% from 3.75%, matching the consensus the market had priced. With the decision fully anticipated, the information sat in the statement's language and the projections rather than in the rate itself, and positioning adjusted accordingly over the following minutes.",
  implication: "A fully priced move shifts the burden onto the next data points; the reaction function is unchanged while inflation prints stay near target.",
  watch: "The next inflation print and the following meeting's projections.",
  ...over,
});

test("a read-out that narrates its own evidence classes is rejected", () => {
  const facts = buildFacts(input());
  const violations = readOutViolations({
    facts,
    readOut: readOut({ read: "A verified pre-release survey consensus, sourced from the calendar, expected 4 percent, so no beat or miss characterisation can be made, and no platform model forecast was available for this release." }),
  });
  assert.ok(violations.some((violation) => violation.includes("meta-commentary")));
});

test("a number the facts do not contain is rejected, and a rounding of one is not", () => {
  const facts = buildFacts(input());
  assert.deepEqual(unsupportedNumbers("The range moved to 4 from 3.75 percent.", facts), []);
  assert.deepEqual(unsupportedNumbers("Inventories fell 9.4 million barrels.", facts), ["9.4"]);
  const violations = readOutViolations({ facts, readOut: readOut({ read: `${readOut().read} The move was 7.3% of the total.` }) });
  assert.ok(violations.some((violation) => violation.includes("numbers not present")));
});

test("a beat claim without a consensus is rejected, and the same text passes with one", () => {
  const without = buildFacts(input({ values: [{ canonicalKey: "US_FED_FUNDS_TARGET_UPPER", nameEn: "Upper", nameZh: null, unit: "PERCENT", actual: 4, consensus: null, previous: 3.75 }] }));
  const text = readOut({ read: `${readOut().read} The result beat expectations for a second month.` });
  assert.ok(readOutViolations({ facts: without, readOut: text }).some((violation) => violation.includes("no survey consensus")));
  assert.deepEqual(readOutViolations({ facts: buildFacts(input()), readOut: text }), []);
});

test("advice is rejected in both languages", () => {
  const facts = buildFacts(input());
  assert.ok(readOutViolations({ facts, readOut: readOut({ implication: "We recommend buying the dip into the next meeting." }) }).some((violation) => violation.includes("advice")));
  assert.ok(readOutViolations({ facts, readOut: readOut({ implication: "建议买入并在下一次会议前持有。" }) }).some((violation) => violation.includes("advice")));
});

test("an empty headline and a stub read are rejected", () => {
  const facts = buildFacts(input());
  const violations = readOutViolations({ facts, readOut: readOut({ headline: " ", read: "As expected." }) });
  assert.ok(violations.some((violation) => violation.includes("headline")));
  assert.ok(violations.some((violation) => violation.includes("shorter than")));
});

test("the fallback read-out always says something checkable, and passes the guard", () => {
  const facts = buildFacts(input());
  const fallback = fallbackReadOut(facts);
  assert.ok(fallback.headline.includes("4"));
  assert.ok(fallback.read.includes("3.75"));
  const violations = readOutViolations({ facts, readOut: fallback });
  assert.deepEqual(violations, [], `fallback violated: ${violations.join("; ")}`);
});
