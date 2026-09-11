import assert from "node:assert/strict";
import test from "node:test";
import { fitX, validatePost, xWeightedLength } from "./content";

test("X fitting keeps bilingual posts inside the weighted limit", () => {
  const text = fitX("数据".repeat(200));
  assert.ok(xWeightedLength(text) <= 275);
  assert.equal(validatePost(text), null);
});

test("main post validation refuses links and promotional claims", () => {
  assert.match(validatePost("read https://example.com") || "", /URL/);
  assert.match(validatePost("稳赚") || "", /prohibited/);
});
