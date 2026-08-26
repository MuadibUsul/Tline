import assert from "node:assert/strict";
import test from "node:test";
import { parseSitemap } from "./sitemap";

test("parses sitemap indexes and URL lastmod values", () => {
  const index = parseSitemap(`<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://example.com/research.xml</loc></sitemap>
  </sitemapindex>`);
  assert.deepEqual(index.indexes, ["https://example.com/research.xml"]);

  const urls = parseSitemap(`<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/research/gold</loc><lastmod>2026-08-26</lastmod></url>
    <url><loc>https://example.com/research/oil.pdf</loc></url>
  </urlset>`);
  assert.equal(urls.urls.length, 2);
  assert.equal(urls.urls[0].lastModified?.toISOString().slice(0, 10), "2026-08-26");
});
