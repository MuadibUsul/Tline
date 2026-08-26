import assert from "node:assert/strict";
import test from "node:test";
import { createArticlePdf } from "./pdf";
import { extractPdf } from "./extractPdf";

test("extracts page-aware text blocks from a PDF", async () => {
  const source = await createArticlePdf({
    title: "Source PDF",
    institution: "Test Bank",
    publishedAt: new Date("2026-08-27T00:00:00.000Z"),
    sourceUrl: "https://example.com/report.pdf",
    locale: "en",
    segments: [{ heading: "Core view", text: "Gold target rises from $4,800 to $5,000." }],
  });
  const extracted = await extractPdf(source.buffer);
  assert.equal(extracted.pageCount, 1);
  assert.match(extracted.text, /Source PDF/);
  assert.match(extracted.text, /\$4,800/);
  assert.ok(extracted.blocks.every((block) => block.page === 0 && block.width > 0 && block.height > 0));
});
