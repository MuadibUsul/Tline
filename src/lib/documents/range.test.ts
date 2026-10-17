import assert from "node:assert/strict";
import test from "node:test";
import { parseRangeHeader } from "./range";

test("a normal PDF range is read as one inclusive byte range", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-262143", 19_343_937), { start: 0, end: 262_143 });
  assert.deepEqual(parseRangeHeader("bytes=262144-", 19_343_937), { start: 262_144, end: 19_343_936 });
  assert.deepEqual(parseRangeHeader("bytes=-500", 1000), { start: 500, end: 999 });
});

test("an open end is clamped to the file and a past-end start is unsatisfiable", () => {
  assert.deepEqual(parseRangeHeader("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.equal(parseRangeHeader("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=500-400", 1000), "unsatisfiable");
  assert.equal(parseRangeHeader("bytes=-0", 1000), "unsatisfiable");
});

test("multi-range and junk headers fall back to the whole file rather than an error", () => {
  assert.equal(parseRangeHeader("bytes=0-99,200-299", 1000), null);
  assert.equal(parseRangeHeader("items=0-99", 1000), null);
  assert.equal(parseRangeHeader(null, 1000), null);
});
