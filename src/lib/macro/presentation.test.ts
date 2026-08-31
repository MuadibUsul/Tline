import assert from "node:assert/strict";
import test from "node:test";
import { actualText, consensusText, macroNumber } from "./presentation";

test("macro UI never renders unknown values as zero", () => {
  assert.equal(macroNumber(null, "en"), "N/A");
  assert.equal(actualText(null, false, "en"), "Not released");
  assert.equal(actualText(null, true, "en"), "N/A");
  assert.equal(consensusText(null, "en"), "No consensus data");
  assert.equal(actualText({ toString: () => "0" }, true, "en"), "0");
});
