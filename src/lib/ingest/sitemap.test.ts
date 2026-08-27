import assert from "node:assert/strict";
import test from "node:test";
import { parseSitemap, sitemapArticleRelevance } from "./sitemap";

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

test("accepts research articles and rejects unrelated sitemap pages", () => {
  const source = "https://www.ubs.com/global/en/wealthmanagement/insights/chief-investment-office/house-view.html";
  assert.ok(sitemapArticleRelevance(
    "https://www.ubs.com/global/en/wealthmanagement/insights/chief-investment-office/market-outlook-august-2026.html",
    source,
  ) > 0);
  assert.equal(sitemapArticleRelevance("https://www.ubs.com/global/de.html", source), 0);
  assert.equal(sitemapArticleRelevance("https://www.ubs.com/global/en/about-us.html", source), 0);
  assert.equal(sitemapArticleRelevance("https://www.ubs.com/global/en/sustainability/esg-publications-policies.html", source), 0);
  assert.equal(sitemapArticleRelevance("https://www.ubs.com/ca/fr/a-propos/responsabilite/publications-code-ethique.html", source), 0);
  assert.equal(sitemapArticleRelevance(source, source), 0);
});
