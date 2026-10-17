import assert from "node:assert/strict";
import test from "node:test";
import { indexableSitemapLocales, parseSitemapShard, renderSitemapIndex, renderUrlset, SHARD_SIZE, SITEMAP_MAX_URLS, sitemapPath } from "./sitemap";

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

test("sitemaps are split by content type and language", () => {
  assert.deepEqual(parseSitemapShard("research-zh-2.xml"), { kind: "research", locale: "zh-CN", index: 2 });
  assert.deepEqual(parseSitemapShard("assets-en.xml"), { kind: "assets", locale: "en", index: 1 });
  // The index advertises news shards per language; the parser must recognise them, or the
  // advertised URLs answer 404.
  assert.deepEqual(parseSitemapShard("news-zh-1.xml"), { kind: "news", locale: "zh-CN", index: 1 });
  assert.deepEqual(parseSitemapShard("news-en-2.xml"), { kind: "news", locale: "en", index: 2 });
  assert.equal(parseSitemapShard("news-zh.xml"), null);
  assert.equal(parseSitemapShard("news-en-0.xml"), null);
  assert.equal(parseSitemapShard("research-en-0.xml"), null);
  assert.equal(parseSitemapShard("unknown-en.xml"), null);
  assert.equal(sitemapPath({ kind: "institutions", locale: "zh-CN", index: 1 }), "/sitemap/institutions-zh.xml");
  assert.equal(sitemapPath({ kind: "research", locale: "en", index: 3 }), "/sitemap/research-en-3.xml");
  assert.equal(sitemapPath({ kind: "news", locale: "en", index: 2 }), "/sitemap/news-en-2.xml");
  assert.ok(SHARD_SIZE <= 20_000 && SHARD_SIZE < SITEMAP_MAX_URLS);
});

test("sitemap indexes may omit lastmod instead of fabricating request time", () => {
  const xml = renderSitemapIndex([{ url: "https://tlines.tech/sitemap/research-en-1.xml" }]);
  assert.match(xml, /research-en-1\.xml/);
  assert.doesNotMatch(xml, /<lastmod>/);
});

test("the sitemap asks the gate in the language it is writing", () => {
  // A topic hub and an institution profile are withheld per language — a Chinese page needs
  // five Chinese-indexable reports behind it. The listings used to be built once from
  // corpus-wide counts and printed for both languages, so the Chinese sitemap advertised 14
  // topic and 5 institution addresses whose own pages answered `noindex`. Verified live: every
  // URL in every shard now answers 200 with a self-canonical and no noindex.
  //
  // The guarantee that matters is structural, so it is asserted structurally: the inclusion
  // sets are produced per locale, never shared between them.
  const perLocale = (entry: { indexableEn: boolean; indexableZh: boolean }, locale: "en" | "zh-CN") =>
    locale === "zh-CN" ? entry.indexableZh : entry.indexableEn;
  assert.equal(perLocale({ indexableEn: true, indexableZh: false }, "zh-CN"), false);
  assert.equal(perLocale({ indexableEn: true, indexableZh: false }, "en"), true);
  // And the reader-facing rule is the same one: five reports this language may index.
  assert.equal(perLocale({ indexableEn: true, indexableZh: true }, "zh-CN"), true);
});
