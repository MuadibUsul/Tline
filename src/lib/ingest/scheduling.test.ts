import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_CIRCUIT_FAILURES, crawlIntervalSeconds, healthyScheduleSeconds, jitterSeconds, runSourcesByOrigin, sourceBackoffSeconds } from "./scheduling";

test("source scheduling is bounded globally and serial per publisher domain", async () => {
  const sources = ["a.test/one", "a.test/two", "b.test/one", "c.test/one"].map((host) => ({ researchUrl: `https://${host}` }));
  let active = 0, maxActive = 0;
  const activeOrigins = new Set<string>();
  await runSourcesByOrigin(sources, 2, async (source) => {
    const origin = new URL(source.researchUrl).origin;
    assert(!activeOrigins.has(origin));
    activeOrigins.add(origin);
    maxActive = Math.max(maxActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    activeOrigins.delete(origin);
  });
  assert.equal(maxActive, 2);
  assert.equal(crawlIntervalSeconds({ rssUrl: "https://a.test/feed", requiresRender: false, crawlIntervalSec: null }), 3600);
  assert.equal(crawlIntervalSeconds({ rssUrl: null, requiresRender: true, crawlIntervalSec: null }), 3600);
  assert.equal(crawlIntervalSeconds({ rssUrl: null, requiresRender: false, crawlIntervalSec: 900 }), 900);
});

test("source protection jitters schedules and escalates repeated access blocks", () => {
  assert.equal(jitterSeconds(100, () => 0), 100);
  assert.equal(jitterSeconds(100, () => 1), 120);
  assert.equal(healthyScheduleSeconds(180, 0, () => 0), 180);
  assert.equal(healthyScheduleSeconds(180, 2, () => 0), 720);
  assert.equal(sourceBackoffSeconds(180, 1, true), 3_600);
  assert.equal(sourceBackoffSeconds(180, 2, true), 14_400);
  assert.equal(sourceBackoffSeconds(180, 3, true), 86_400);
  assert.equal(sourceBackoffSeconds(600, 8), 86_400);
  assert.equal(ACCESS_CIRCUIT_FAILURES, 6);
});
