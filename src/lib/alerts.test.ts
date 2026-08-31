import assert from "node:assert/strict";
import test from "node:test";
import { describeRule, ruleScope, stanceChanged, surpriseThresholdMet } from "./alerts";

test("keeps legacy asset rules compatible", () => {
  assert.deepEqual(ruleScope({ type: "CONSENSUS_ABOVE", threshold: 75, assetTicker: "WTI" }), { kind: "asset", ref: "WTI" });
});

test("macro surprise rules require a real consensus-derived surprise", () => {
  assert.equal(surpriseThresholdMet("MACRO_SURPRISE_ABOVE", null, 1), false);
  assert.equal(surpriseThresholdMet("MACRO_SURPRISE_ABOVE", "0.012", 1), true);
  assert.equal(surpriseThresholdMet("MACRO_SURPRISE_BELOW", "-0.025", -2), true);
});

test("policy stance changes ignore unknown and unchanged classifications", () => {
  assert.equal(stanceChanged("HAWKISH", "DOVISH"), true);
  assert.equal(stanceChanged("HAWKISH", "HAWKISH"), false);
  assert.equal(stanceChanged("UNKNOWN", "DOVISH"), false);
});

test("macro rules use the existing scope fields", () => {
  assert.deepEqual(ruleScope({ type: "MACRO_RELEASE", threshold: 0, scopeKind: "macro_indicator", scopeRef: "US_CPI_HEADLINE" }), { kind: "macro_indicator", ref: "US_CPI_HEADLINE" });
  assert.match(describeRule({ type: "MACRO_REVISION", threshold: 0, scopeKind: "macro_indicator", scopeRef: "US_CPI_HEADLINE" }), /revision/);
});

test("describes institution and theme research monitors", () => {
  assert.equal(describeRule({ type: "NEW_RESEARCH", threshold: 0, scopeKind: "institution", scopeRef: "goldman" }, "zh-CN"), "机构「goldman」发布相关新研报");
  assert.equal(describeRule({ type: "NEW_RESEARCH", threshold: 0, scopeKind: "theme", scopeRef: "AI capex" }), "new research for theme “AI capex”");
});

test("market scope is explicit for consensus rules", () => {
  const rule = { type: "CONSENSUS_RISE_24H", threshold: 8, scopeKind: "market", scopeRef: null };
  assert.deepEqual(ruleScope(rule), { kind: "market", ref: null });
  assert.equal(describeRule(rule, "zh-CN"), "任一精选资产 24小时共识上升 ≥ 8");
});
