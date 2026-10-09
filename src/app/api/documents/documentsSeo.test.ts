import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_ROBOTS } from "@/lib/site";

test("document responses tell crawlers not to index without blocking the fetch", () => {
  assert.deepEqual(DOCUMENT_ROBOTS, { "x-robots-tag": "noindex, nofollow" });
});
