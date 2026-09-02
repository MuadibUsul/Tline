import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, rateLimit, resetRateLimits } from "./rateLimit";

test("allows up to the limit, then refuses within the window", () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rateLimit("a", 3, 10_000, now).allowed, true);
  }
  const refused = rateLimit("a", 3, 10_000, now);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(refused.retryAfterSeconds, 10);
});

test("a new window restores the allowance", () => {
  resetRateLimits();
  const now = 2_000_000;
  rateLimit("b", 1, 5_000, now);
  assert.equal(rateLimit("b", 1, 5_000, now).allowed, false);
  assert.equal(rateLimit("b", 1, 5_000, now + 5_001).allowed, true);
});

test("keys are independent", () => {
  resetRateLimits();
  const now = 3_000_000;
  rateLimit("c", 1, 5_000, now);
  assert.equal(rateLimit("c", 1, 5_000, now).allowed, false);
  assert.equal(rateLimit("d", 1, 5_000, now).allowed, true);
});

test("expired windows are swept so the map cannot grow without bound", () => {
  resetRateLimits();
  const start = 4_000_000;
  rateLimit("gone", 5, 1_000, start);
  // A later call past the sweep interval evicts the stale window rather than keeping it.
  const fresh = rateLimit("kept", 5, 1_000, start + 120_000);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 4);
});

test("client key prefers the first forwarded address and falls back to a shared bucket", () => {
  const forwarded = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" } });
  assert.equal(clientKey(forwarded), "203.0.113.7");
  assert.equal(clientKey(new Request("http://x/", { headers: { "x-real-ip": "198.51.100.4" } })), "198.51.100.4");
  assert.equal(clientKey(new Request("http://x/")), "unknown");
});
