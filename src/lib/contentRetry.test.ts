import assert from "node:assert/strict";
import test from "node:test";
import { MAX_AUTOMATIC_RETRY_ATTEMPTS, retryPassed } from "./contentRetry";

test("a retry succeeds only when its quality threshold is met", () => {
  assert.equal(retryPassed("analysis", 0), false);
  assert.equal(retryPassed("analysis", 1), true);
  assert.equal(retryPassed("translation", 0.79), false);
  assert.equal(retryPassed("translation", 0.8), true);
  assert.equal(retryPassed("translation", null), false);
});

test("the automatic retry queue gives up instead of running forever", () => {
  // One analysis retry in production had reached 2,153 attempts and 158 translation retries
  // had failed, because a rerun that cannot reach the threshold re-queues itself each time
  // it finishes. Three is the ceiling for a queue nobody asked for.
  assert.equal(MAX_AUTOMATIC_RETRY_ATTEMPTS, 3);
  // The ceiling is on automatic re-queueing: an operator's request carries a reason the
  // queue cannot know — a prompt fix, a glossary change — and is not refused.
  const automatic = (attempt: number) => !(attempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS);
  assert.equal(automatic(0), true);
  assert.equal(automatic(2), true);
  assert.equal(automatic(3), false);
  assert.equal(automatic(2153), false);
});
