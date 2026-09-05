import assert from "node:assert/strict";
import test from "node:test";
import { breadcrumbJsonLd, canonical, reportJsonLd, siteJsonLd } from "./seo";

process.env.SITE_URL = "https://tlines.tech";

test("canonical and hreflang use stable locale-prefixed URLs", () => {
  const metadata = canonical("/research/abc", "zh-CN");
  assert.equal(metadata.alternates?.canonical, "https://tlines.tech/zh/research/abc");
  assert.deepEqual(metadata.alternates?.languages, {
    en: "https://tlines.tech/en/research/abc",
    "zh-Hans": "https://tlines.tech/zh/research/abc",
    "x-default": "https://tlines.tech/en/research/abc",
  });
});

test("article, breadcrumb and search schema preserve the page locale", () => {
  const article = reportJsonLd({ id: "abc", title: "A sourced market view", description: "Summary", publishedAt: new Date("2026-09-01T00:00:00Z"), institution: "Example Bank", sourceUrl: "https://example.com/report", locale: "zh-CN" });
  assert.equal(article.url, "https://tlines.tech/zh/research/abc");
  assert.equal(article.mainEntityOfPage["@id"], article.url);
  assert.equal((article as { translationOfWork: { "@id": string } }).translationOfWork["@id"], "https://tlines.tech/en/research/abc");
  const crumbs = breadcrumbJsonLd("zh-CN", [{ name: "研报", path: "/research" }]);
  assert.equal(crumbs.itemListElement[0].item, "https://tlines.tech/zh/research");
  const site = siteJsonLd("zh-CN", "描述");
  assert.match(site.potentialAction.target.urlTemplate, /^https:\/\/tlines\.tech\/zh\/research/);
});
