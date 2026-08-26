import assert from "node:assert/strict";
import test from "node:test";
import { createArticlePdf } from "./pdf";
import { createTranslatedNativePdf } from "./nativeLayout";

test("native layout translation preserves the source page count", async () => {
  const source = await createArticlePdf({
    title: "Source PDF",
    institution: "Test Bank",
    publishedAt: new Date("2026-08-27T00:00:00.000Z"),
    sourceUrl: "https://example.com/report.pdf",
    locale: "en",
    segments: [{ heading: null, text: "Original text remains outside translated blocks." }],
  });
  const translated = await createTranslatedNativePdf(source.buffer, [{
    page: 0,
    x: 54,
    y: 300,
    width: 480,
    height: 80,
    text: "这是保留原始页面结构的中文文本块。",
    fontSize: 11,
  }]);
  assert.equal(translated.pageCount, source.pageCount);
  assert.equal(translated.buffer.subarray(0, 5).toString(), "%PDF-");
});
