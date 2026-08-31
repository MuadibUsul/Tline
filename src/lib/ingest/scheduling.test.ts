import assert from "node:assert/strict";
import test from "node:test";
import { crawlIntervalSeconds, runSourcesByOrigin } from "./scheduling";

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
  assert.equal(crawlIntervalSeconds({ rssUrl: "https://a.test/feed", requiresRender: false, crawlIntervalSec: null }), 60);
  assert.equal(crawlIntervalSeconds({ rssUrl: null, requiresRender: true, crawlIntervalSec: null }), 600);
});
