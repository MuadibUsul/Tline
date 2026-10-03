import assert from "node:assert/strict";
import test from "node:test";
import { indexableSitemapLocales, renderUrlset } from "./sitemap";

test("a shard takes the gate's stored verdict rather than recomputing it", () => {
  // It used to run `contentQuality` per article, which needs the body and the translation —
  // 18 KB per report, about 34 MB for a full shard, to produce a 1.39 MB document. The verdict
  // is a column now, written whenever an input changes, so the shard reads two booleans.
  assert.deepEqual(indexableSitemapLocales({ indexableEn: true, indexableZh: true }), ["en", "zh-CN"]);
  assert.deepEqual(indexableSitemapLocales({ indexableEn: true, indexableZh: false }), ["en"]);
  assert.deepEqual(indexableSitemapLocales({ indexableEn: false, indexableZh: true }), ["zh-CN"]);
  // Public in neither language: no page exists, so no address is advertised.
  assert.deepEqual(indexableSitemapLocales({ indexableEn: false, indexableZh: false }), []);
});

test("rendered sitemap contains only the canonical URLs it is given", () => {
  const xml = renderUrlset([{ url: "https://tlines.tech/en/research/example", lastModified: new Date("2026-09-01T00:00:00Z") }]);
  assert.match(xml, /https:\/\/tlines\.tech\/en\/research\/example/);
  assert.doesNotMatch(xml, /[?&]q=/);
});
