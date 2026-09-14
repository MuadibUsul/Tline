import assert from "node:assert/strict";
import test from "node:test";
import { fitX, macroPosts, researchPosts, validatePost, xWeightedLength } from "./content";

test("X fitting keeps bilingual posts inside the weighted limit", () => {
  const text = fitX("数据".repeat(200));
  assert.ok(xWeightedLength(text) <= 275);
  assert.equal(validatePost(text), null);
});

test("research posts reserve the title space for the analysis", () => {
  const posts = researchPosts({ institution: "HSBC", summaryEn: "Summary", summaryZh: "摘要" });
  assert.ok(posts.en.startsWith("RESEARCH | HSBC\n\nSummary"));
  assert.ok(posts.zh.startsWith("研报 | HSBC\n\n摘要"));
});

test("macro posts cannot claim a surprise without verified consensus", () => {
  assert.throws(() => macroPosts({ titleEn: "CPI", values: [{ nameEn: "CPI", actual: "3.1" }], analysisEn: "CPI beat expectations.", analysisZh: "CPI 超预期。" }), /survey-consensus/);
  assert.doesNotThrow(() => macroPosts({ titleEn: "CPI", values: [{ nameEn: "CPI", actual: "3.1" }], analysisEn: "CPI rose from the prior month.", analysisZh: "CPI 较前月上升。" }));
});

test("main post validation refuses links and promotional claims", () => {
  assert.match(validatePost("read https://example.com") || "", /URL/);
  assert.match(validatePost("稳赚") || "", /prohibited/);
});
