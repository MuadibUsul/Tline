import assert from "node:assert/strict";
import test from "node:test";
import { retryPassed } from "./contentRetry";

test("a retry succeeds only when its quality threshold is met", () => {
  assert.equal(retryPassed("analysis", 0), false);
  assert.equal(retryPassed("analysis", 1), true);
  assert.equal(retryPassed("translation", 0.79), false);
  assert.equal(retryPassed("translation", 0.8), true);
  assert.equal(retryPassed("translation", null), false);
});
