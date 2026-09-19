import assert from "node:assert/strict";
import test from "node:test";
import { articleClassificationSourceFingerprint, classificationFingerprint } from "./store";

test("classification fingerprints change with title, content, taxonomy inputs and structured assets", () => {
  const target = { kind: "ARTICLE" as const, id: "article-1" };
  const source = articleClassificationSourceFingerprint("body", "title", ["USD", "SPX"]);
  assert.equal(source, articleClassificationSourceFingerprint("body", "title", ["SPX", "USD"]));
  assert.notEqual(source, articleClassificationSourceFingerprint("body", "new-title", ["SPX", "USD"]));
  assert.notEqual(source, articleClassificationSourceFingerprint("new-body", "title", ["SPX", "USD"]));
  assert.notEqual(source, articleClassificationSourceFingerprint("body", "title", ["SPX"]));
  assert.equal(classificationFingerprint(target, source), classificationFingerprint(target, source));
});
