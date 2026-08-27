import assert from "node:assert/strict";
import test from "node:test";
import { describeRule, ruleScope } from "./alerts";

test("keeps legacy asset rules compatible", () => {
  assert.deepEqual(ruleScope({ type: "CONSENSUS_ABOVE", threshold: 75, assetTicker: "WTI" }), { kind: "asset", ref: "WTI" });
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
