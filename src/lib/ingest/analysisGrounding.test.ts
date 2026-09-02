import test from "node:test";
import assert from "node:assert/strict";
import { validateAnalysisGrounding } from "./analysisGrounding";

const codes = (result: ReturnType<typeof validateAnalysisGrounding>) => result.issues.map((issue) => issue.code);
const details = (result: ReturnType<typeof validateAnalysisGrounding>) => result.issues.map((issue) => issue.detail);

test("an analysis whose figures all appear in the article passes", () => {
  const source = "The Riksbank raised its GDP forecast to 2.7 per cent for 2026, with inflation at 1.9%.";
  const result = validateAnalysisGrounding({
    summary: "Growth was revised to 2.7% and inflation runs at 1.9%.",
    keyNumbers: [{ label: "GDP", value: "2.7%" }, { label: "CPI", value: "1.9%" }],
  }, source);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
});

test("a figure that appears nowhere in the article is flagged", () => {
  const source = "The Riksbank raised its GDP forecast to 2.7 per cent for 2026.";
  const result = validateAnalysisGrounding({
    summary: "Growth was revised to 2.7%, and unemployment will reach 8.4%.",
  }, source);
  assert.deepEqual(codes(result), ["number_unsupported"]);
  assert.deepEqual(details(result), ["8.4%"]);
});

// Each of the following cases was an observed false positive on the live corpus.
test("'per cent' in the source matches '%' in the analysis", () => {
  const source = "Swedish GDP is forecast at 2.7 per cent, followed by 2.9 per cent.";
  const result = validateAnalysisGrounding({ summary: "GDP of 2.7% then 2.9%." }, source);
  assert.equal(result.passed, true);
});

test("'basis points' in the source matches 'bps' in the analysis", () => {
  const source = "The central bank delivered 25 basis points of tightening.";
  const result = validateAnalysisGrounding({ summary: "A 25bps hike." }, source);
  assert.equal(result.passed, true);
});

test("trailing zeros do not make a figure look invented", () => {
  const source = "The policy rate stands at 3%.";
  const result = validateAnalysisGrounding({ keyNumbers: [{ label: "rate", value: "3.00%" }] }, source);
  assert.equal(result.passed, true);
});

test("a direction sign added by the summary is not an invented figure", () => {
  const source = "The Nasdaq has fallen 1.9% and the semiconductor index declined 8.2%.";
  const result = validateAnalysisGrounding({
    keyNumbers: [{ label: "Nasdaq", value: "-1.9%" }, { label: "SOX", value: "-8.2%" }],
  }, source);
  assert.equal(result.passed, true);
});

test("date separators do not become phantom figures", () => {
  const source = "Published 25 August 2026. Growth reached 4.6 per cent.";
  const result = validateAnalysisGrounding({
    keyNumbers: [{ label: "Published", value: "2026-08-25" }, { label: "Growth", value: "4.6%" }],
  }, source);
  assert.equal(result.passed, true);
});

test("Chinese fields are not number-checked against the English source", () => {
  // "$900bn" is idiomatically rendered as 9000亿, whose 9000 is absent from the English.
  const source = "AI capex is estimated at $900bn next year.";
  const result = validateAnalysisGrounding({
    keyNumbers: [{ label: "capex", value: "$900bn" }],
    keyNumbersZh: [{ label: "资本开支", value: "9000亿美元" }],
  }, source);
  assert.equal(result.passed, true);
});

test("a central bank the article never mentions is flagged", () => {
  const source = "European growth is holding up better than expected across the euro area.";
  const result = validateAnalysisGrounding({
    summary: "The Bank of Japan is expected to tighten further.",
  }, source);
  assert.deepEqual(codes(result), ["entity_unsupported"]);
  assert.deepEqual(details(result), ["Bank of Japan"]);
});

test("a bare 'Fed' in the article supports a Federal Reserve claim", () => {
  const source = "Fed officials signalled patience at the last meeting.";
  const result = validateAnalysisGrounding({ summary: "The Federal Reserve stays on hold." }, source);
  assert.equal(result.passed, true);
});

test("lowercase 'fed' as a verb does not license a Federal Reserve claim", () => {
  const source = "Higher import costs fed through to consumer prices during the quarter.";
  const result = validateAnalysisGrounding({ summary: "The FOMC will cut rates." }, source);
  assert.deepEqual(codes(result), ["entity_unsupported"]);
});

test("certainty the article never asserts is flagged", () => {
  const source = "Inflation may ease further if energy prices stay contained.";
  const result = validateAnalysisGrounding({ summaryZh: "通胀必将回落。" }, source);
  assert.deepEqual(codes(result), ["certainty_upgrade"]);
});

test("an asset identified by its alias is not treated as invented", () => {
  const source = "The Philadelphia Semiconductor Index fell sharply over the past 10 days.";
  const result = validateAnalysisGrounding({ summary: "SOX weakened materially." }, source);
  assert.equal(result.passed, true);
});

test("an asset the article never discusses is flagged", () => {
  const source = "European power demand is set to grow through 2050.";
  const result = validateAnalysisGrounding({ summary: "We are constructive on BTC." }, source);
  assert.deepEqual(codes(result), ["entity_unsupported"]);
  assert.deepEqual(details(result), ["BTC"]);
});

test("issues are deduplicated and lower the score", () => {
  const source = "Growth is steady.";
  const result = validateAnalysisGrounding({
    summary: "Growth reaches 8.4%.",
    keyArguments: ["Growth reaches 8.4%."],
  }, source);
  // Same code/detail in two different fields stays distinct; the same field does not repeat.
  assert.equal(result.issues.length, 2);
  assert.equal(result.passed, false);
  assert.ok(result.score < 1);
});
