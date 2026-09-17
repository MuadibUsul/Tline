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

test("document labels are withheld, and real headlines that mention a file are not", () => {
  // Both were live and indexed: a page whose subject (EU and UK financial services
  // regulation) appeared only in the schema, and one extracted from a PDF caption.
  for (const title of ['Download the PDF "Ongoing Developments Part 1"', "PDF 777 Kb", "file of entire text", "View the document"]) {
    assert.equal(contentQuality({ ...valid, title }, "en").indexable, false, `should be withheld: ${title}`);
  }
  // A publisher's headline that happens to mention a download is still a headline.
  assert.equal(contentQuality({ ...valid, title: "Download the report on Q3 earnings" }, "en").indexable, true);
  assert.equal(contentQuality({ ...valid, title: "Gold heads for third weekly gain" }, "en").indexable, true);
});

test("an analysis without structured arrays is not by itself grounds for noindex", () => {
  // A rule that withheld these was measured at 17% of production report pages, including
  // market-commentary roundups that make no falsifiable call and so have empty arrays by
  // nature, and pages carrying a written conclusion and thousands of words. It was removed;
  // this keeps it from returning without evidence.
  const analysis = { summary: "A sourced conclusion for a defined period.", summaryZh: "有来源支持的结论。", reviewStatus: "ok", keyArguments: "[]", keyNumbers: "[]", risks: "[]", interpretation: null };
  assert.equal(contentQuality({ ...valid, analysis }, "en").indexable, true);
  assert.equal(contentQuality({ ...valid, analysis: { ...analysis, summary: "" } }, "en").indexable, false);
});

test("missing essential content is not generated as a public SEO page", () => {
  const result = contentQuality({ ...valid, rawText: null }, "en");
  assert.equal(result.eligibility, "NOT_GENERATED");
});
