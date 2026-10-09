import assert from "node:assert/strict";
import test from "node:test";
import { validateStructuredResearch } from "./researchQuality";

const codes = (result: ReturnType<typeof validateStructuredResearch>) => result.issues.map((issue) => issue.code);

test("keeps only a source-backed target with an explicit unit and horizon", () => {
  const source = "The bank raised its year-end 2027 gold price target from $4,800 to $5,000 as central-bank demand stayed firm.";
  const result = validateStructuredResearch(
    { summary: "The bank lifted its gold objective as official-sector demand remained supportive." },
    source,
    [{ ticker: "XAUUSD", previousTarget: 4800, target: 5000, timeHorizon: "year-end 2027" }],
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.forecasts[0], { ticker: "XAUUSD", previousTarget: 4800, target: 5000, timeHorizon: "year-end 2027" });
});

test("clears a target instead of inferring its missing horizon", () => {
  const result = validateStructuredResearch({}, "The bank raised its gold price target to $5,000.", [
    { ticker: "XAUUSD", target: 5000, timeHorizon: null },
  ]);
  assert.ok(codes(result).includes("forecast_horizon_missing"));
  assert.equal(result.forecasts[0].target, null);
});

test("clears a target whose number or unit is not in the source", () => {
  const unsupported = validateStructuredResearch({}, "The year-end 2027 gold outlook remains constructive.", [
    { ticker: "XAUUSD", target: 5000, timeHorizon: "year-end 2027" },
  ]);
  assert.ok(codes(unsupported).includes("forecast_target_unsupported"));
  assert.equal(unsupported.forecasts[0].target, null);

  const unitless = validateStructuredResearch({}, "The bank set a year-end 2027 gold target of 5,000.", [
    { ticker: "XAUUSD", target: 5000, timeHorizon: "year-end 2027" },
  ]);
  assert.ok(codes(unitless).includes("forecast_unit_missing"));
  assert.equal(unitless.forecasts[0].target, null);

  const unsupportedUnit = validateStructuredResearch({}, "The bank set a year-end 2027 target of €5,000.", [
    { ticker: "SX5E", target: 5000, timeHorizon: "year-end 2027" },
  ]);
  assert.ok(codes(unsupportedUnit).includes("forecast_unit_unsupported"));
  assert.equal(unsupportedUnit.forecasts[0].target, null);
});

test("flags copied leads, boilerplate conclusions and unsupported forecast years", () => {
  const lead = "Growth should improve to 2.7% in 2027 as household demand recovers.";
  const source = `${lead} Risks remain tilted to weaker exports.`;
  const result = validateStructuredResearch({
    summary: lead,
    risks: ["For informational purposes only; this does not constitute investment advice."],
    keyArguments: ["Growth should improve in 2026."],
  }, source);
  assert.ok(codes(result).includes("summary_copies_source_lead"));
  assert.ok(codes(result).includes("boilerplate_in_analysis"));
  assert.ok(codes(result).includes("forecast_year_unsupported"));
});

test("60-report bilingual, multi-institution and multi-asset regression corpus stays deterministic", () => {
  const institutions = ["Aster", "Beacon", "Cedar", "Delta", "Elm", "Fjord", "Grove", "Harbor", "Iris", "Juniper", "Keystone", "Linden"];
  const assets = ["gold", "oil", "equities", "bonds", "the dollar"];
  const reports = institutions.flatMap((institution, institutionIndex) => assets.map((asset, kind) => {
    const year = 2026 + (institutionIndex % 2);
    const base = `${institution} expects ${asset} conditions to improve by ${year}, while demand growth reaches 2.7% and policy remains a risk.`;
    if (kind === 0) return { source: base, fields: { summary: `${institution} sees improving ${asset} conditions, supported by 2.7% demand growth.`, summaryZh: `${institution}认为${asset}环境改善，需求增长2.7%。` }, expected: true };
    if (kind === 1) return { source: base, fields: { summary: base }, issue: "summary_copies_source_lead" };
    if (kind === 2) return { source: base, fields: { summary: `${institution} sees improving ${asset} conditions.`, risks: ["Subscribe to our newsletter and follow us."] }, issue: "boilerplate_in_analysis" };
    if (kind === 3) return { source: base, fields: { summary: `${institution} expects ${asset} conditions to improve in 2028.` }, issue: "forecast_year_unsupported" };
    return { source: base, fields: { summary: `${institution} expects ${asset} conditions to improve as demand growth reaches 8.9%.` }, issue: "number_unsupported" };
  }));

  assert.equal(reports.length, 60);
  let expectedPasses = 0;
  for (const report of reports) {
    const result = validateStructuredResearch(report.fields, report.source);
    if (report.expected) {
      assert.equal(result.passed, true, report.source);
      expectedPasses += 1;
    } else {
      assert.ok(result.issues.some((issue) => issue.code === report.issue), `${report.issue}: ${report.source}`);
    }
  }
  assert.equal(expectedPasses, 12);
});
