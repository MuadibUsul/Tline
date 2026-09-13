import assert from "node:assert/strict";
import test from "node:test";
import { indexableSitemapLocales, renderUrlset } from "./sitemap";

const article = {
  title: "Global markets outlook for the coming quarter",
  rawText: "Institutional research with source evidence and context. ".repeat(10),
  sourceUrl: "https://example.com/research/outlook",
  language: "en",
  analysis: { summary: "A sourced conclusion.", summaryZh: "有来源支持的结论。", reviewStatus: "ok" },
  translations: [{ title: "下一季度全球市场展望", text: "带来源和上下文的完整中文译文。".repeat(30), qualityScore: 0.9, status: "reviewed" }],
};

test("sitemap locales exclude a noindex translation while retaining the good source page", () => {
  assert.deepEqual(indexableSitemapLocales(article), ["en", "zh-CN"]);
  assert.deepEqual(indexableSitemapLocales({ ...article, translations: [{ ...article.translations[0], qualityScore: 0.4 }] }), ["en"]);
});

test("rendered sitemap contains only the canonical URLs it is given", () => {
  const xml = renderUrlset([{ url: "https://tlines.tech/en/research/example", lastModified: new Date("2026-09-01T00:00:00Z") }]);
  assert.match(xml, /https:\/\/tlines\.tech\/en\/research\/example/);
  assert.doesNotMatch(xml, /[?&]q=/);
});
