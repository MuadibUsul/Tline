import assert from "node:assert/strict";
import test from "node:test";
import { parseSitemap, sitemapArticleRelevance, sitemapDateHint } from "./sitemap";

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
  assert.equal(sitemapArticleRelevance(
    "https://www.nordea.com/en/doc/nordea-erp-tms-newsletter-june-2026-0.pdf",
    "https://www.nordea.com/en/news-and-insights",
  ), 0);
  assert.equal(sitemapArticleRelevance(
    "https://www.uobgroup.com/asean-insights/articles/investment-bright-spot.page",
    "https://www.uobgroup.com/research/index.page",
  ), 0);
});

test("uses publication paths before recently edited sitemap timestamps", () => {
  const edited = new Date("2026-08-24T00:00:00Z");
  assert.equal(
    sitemapDateHint("https://example.com/insights/2026/02/older-report", edited)?.toISOString().slice(0, 10),
    "2026-02-01",
  );
});
