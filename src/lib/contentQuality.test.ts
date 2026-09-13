import assert from "node:assert/strict";
import test from "node:test";
import { contentQuality } from "./contentQuality";

const valid = {
  title: "Global markets outlook for the coming quarter",
  rawText: "Institutional research with evidence, context and source detail. ".repeat(10),
  sourceUrl: "https://example.com/research/outlook",
  language: "en",
  analysis: { summary: "A sourced conclusion for a defined period.", summaryZh: "特定时期内有来源支持的结论。", reviewStatus: "ok" },
  translations: [{ title: "下一季度全球市场展望", text: "这是保留数字、来源和上下文的完整中文译文。".repeat(20), qualityScore: 0.9, status: "reviewed" }],
};

test("quality gate opens only a complete, grounded locale version", () => {
  assert.equal(contentQuality(valid, "en").indexable, true);
  assert.equal(contentQuality(valid, "zh-CN").indexable, true);
});

test("index validation catches broken words and low translation quality", () => {
  const result = contentQuality({ ...valid, title: "Vi e wp oint markets", translations: [{ ...valid.translations[0], qualityScore: 0.4 }] }, "zh-CN");
  assert.equal(result.indexable, false);
  assert.ok(result.issues.includes("garbled_or_broken_words"));
  assert.equal(result.issues.includes("translation_below_threshold"), true);
  assert.equal(result.eligibility, "NOINDEX_FOLLOW");
});

test("content requiring human review remains viewable but is noindex", () => {
  const result = contentQuality({
    ...valid,
    analysis: { ...valid.analysis, reviewStatus: "needs_review" },
    translations: [{ ...valid.translations[0], qualityScore: 0, status: "needs_review" }],
  }, "zh-CN");
  assert.equal(result.indexable, false);
  assert.equal(result.eligibility, "NOINDEX_FOLLOW");
});

test("quality gate withholds call-to-action titles from indexing", () => {
  const result = contentQuality({ ...valid, title: "Go to Article" }, "en");
  assert.equal(result.indexable, false);
  assert.ok(result.issues.includes("abnormal_title"));
});

test("missing essential content is not generated as a public SEO page", () => {
  const result = contentQuality({ ...valid, rawText: null }, "en");
  assert.equal(result.eligibility, "NOT_GENERATED");
});
