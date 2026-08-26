import assert from "node:assert/strict";
import test from "node:test";
import { createArticlePdf } from "./pdf";

test("a short article PDF is valid and does not gain a blank footer page", async () => {
  const result = await createArticlePdf({
    title: "Gold target raised to $5,000",
    institution: "Test Bank",
    author: "Research",
    publishedAt: new Date("2026-08-27T00:00:00.000Z"),
    sourceUrl: "https://example.com/research/gold",
    locale: "en",
    segments: [{ heading: "Core view", text: "We raise our target from $4,800 to $5,000." }],
  });
  assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(result.pageCount, 1);
});
