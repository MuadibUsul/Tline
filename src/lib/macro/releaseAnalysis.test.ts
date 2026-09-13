import assert from "node:assert/strict";
import test from "node:test";
import { analysisContainsUnsupportedExpectationClaim } from "./releaseAnalysis";

test("rejects surprise language when no survey consensus exists", () => {
  assert.equal(analysisContainsUnsupportedExpectationClaim("The print beat market expectations.", false), true);
  assert.equal(analysisContainsUnsupportedExpectationClaim("实际值超预期。", false), true);
  assert.equal(analysisContainsUnsupportedExpectationClaim("The print rose from the previous period.", false), false);
});

test("allows surprise language when a survey snapshot exists", () => {
  assert.equal(analysisContainsUnsupportedExpectationClaim("The print missed consensus.", true), false);
});
