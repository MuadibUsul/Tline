import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnPath } from "./authReturn";

test("a signed-in reader returns to the local page they came from", () => {
  assert.equal(safeReturnPath("/zh/research/example"), "/zh/research/example");
  assert.equal(safeReturnPath("/en/research/example?from=feed#summary"), "/en/research/example?from=feed#summary");
  assert.equal(safeReturnPath("/zh/research/example", "/zh"), "/zh/research/example");
});

test("open redirects and path confusion fall back", () => {
  for (const value of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "%2F%2Fevil.example",
    "/%5Cevil.example",
    "javascript:alert(1)",
    "/ok\u0000",
    "",
  ]) {
    assert.equal(safeReturnPath(value, "/zh"), "/zh", value);
  }
});

test("an overlong return target falls back", () => {
  assert.equal(safeReturnPath(`/zh/${"a".repeat(3000)}`, "/zh"), "/zh");
});
