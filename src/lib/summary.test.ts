import assert from "node:assert/strict";
import test from "node:test";
import { derivedSummaryZh, effectiveSummaryZh } from "./summary";

test("a stored Chinese summary always wins over the translation's opening", () => {
  assert.equal(
    effectiveSummaryZh({ summaryZh: "模型写出的结论。", translation: { text: "译文正文的开头。".repeat(20) } }),
    "模型写出的结论。",
  );
});

test("a blank stored summary is treated as absent rather than as a value", () => {
  const derived = effectiveSummaryZh({ summaryZh: "   ", translation: { text: "美联储在本次会议上维持利率不变，并强调后续数据依赖。其余内容略。".repeat(5) } });
  assert.equal(derived, "美联储在本次会议上维持利率不变，并强调后续数据依赖。");
});

test("the derived summary stops at the first complete sentence", () => {
  const text = "报告认为，关税对通胀的传导比预期更慢。这一判断基于三月的进口价格数据。";
  assert.equal(derivedSummaryZh(text), "报告认为，关税对通胀的传导比预期更慢。");
});

test("a body with no sentence boundary is cut at a readable width", () => {
  const derived = derivedSummaryZh("一二三四五六七八九十".repeat(40));
  assert.ok(derived);
  assert.equal(derived.endsWith("…"), true);
  assert.equal(derived.length, 121);
});

test("markdown headings and list markers are not mistaken for the summary", () => {
  assert.equal(derivedSummaryZh("## 完整中文译文\n\n欧元区通胀在八月回落至目标附近。"), "欧元区通胀在八月回落至目标附近。");
  assert.equal(derivedSummaryZh("- 第一项要点说明\n- 第二项要点说明"), "第一项要点说明 第二项要点说明");
});

test("nothing to derive from yields null rather than an empty string", () => {
  assert.equal(effectiveSummaryZh({ summaryZh: null, translation: null }), null);
  assert.equal(effectiveSummaryZh({ summaryZh: null, translation: { text: "   \n  " } }), null);
  assert.equal(effectiveSummaryZh({}), null);
});
