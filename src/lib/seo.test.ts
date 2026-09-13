import assert from "node:assert/strict";
import test from "node:test";
import { assetSeoTitle, breadcrumbJsonLd, canonical, homeSeoTitle, institutionProfileJsonLd, institutionSeoTitle, reportJsonLd, siteJsonLd } from "./seo";

process.env.SITE_URL = "https://tlines.tech";

test("canonical and hreflang use stable locale-prefixed URLs", () => {
  const metadata = canonical("/research/abc", "zh-CN");
  assert.equal(metadata.alternates?.canonical, "https://tlines.tech/zh/research/abc");
  assert.deepEqual(metadata.alternates?.languages, {
    en: "https://tlines.tech/en/research/abc",
    "zh-CN": "https://tlines.tech/zh/research/abc",
    "x-default": "https://tlines.tech/en/research/abc",
  });
});

test("institution profiles name their main entity", () => {
  const profile = institutionProfileJsonLd("zh-CN", "/institution/mufg", "三菱日联金融集团", "机构研报", "https://www.mufgresearch.com/");
  assert.equal(profile["@type"], "ProfilePage");
  assert.equal(profile.mainEntity["@type"], "Organization");
  assert.equal(profile.mainEntity.name, "三菱日联金融集团");
  assert.equal(profile.mainEntity.mainEntityOfPage["@id"], profile["@id"]);
});

test("article, breadcrumb and search schema preserve the page locale", () => {
  const article = reportJsonLd({ slug: "example-bank-market-view-abc1234567", title: "A sourced market view", description: "Summary", publishedAt: new Date("2026-09-01T00:00:00Z"), institution: "Example Bank", sourceUrl: "https://example.com/report", locale: "zh-CN", hasTranslation: true });
  assert.equal(article.url, "https://tlines.tech/zh/research/example-bank-market-view-abc1234567");
  assert.equal(article.mainEntityOfPage["@id"], article.url);
  assert.equal(article.publisher.name, "Example Bank");
  assert.equal(article.sdPublisher["@id"], "https://tlines.tech/#organization");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(article)));
  assert.equal((article as { translationOfWork: { "@id": string } }).translationOfWork["@id"], "https://tlines.tech/en/research/example-bank-market-view-abc1234567");
  const crumbs = breadcrumbJsonLd("zh-CN", [{ name: "研报", path: "/research" }]);
  assert.equal(crumbs.itemListElement[0].item, "https://tlines.tech/zh/research");
  const site = siteJsonLd("zh-CN", "描述");
  assert.equal(site.url, "https://tlines.tech/zh");
  assert.equal("potentialAction" in site, false);
});

test("English-only reports do not claim a nonexistent translation", () => {
  const article = reportJsonLd({ slug: "english-only", title: "English only", description: "Summary", publishedAt: new Date("2026-09-01T00:00:00Z"), institution: "Example Bank", sourceUrl: "https://example.com/report", locale: "en", hasTranslation: false });
  assert.equal("workTranslation" in article, false);
});

test("missing translations do not emit a nonexistent Chinese alternate", () => {
  const metadata = canonical("/research/english-only", "en", ["en"]);
  assert.deepEqual(metadata.alternates?.languages, {
    en: "https://tlines.tech/en/research/english-only",
    "x-default": "https://tlines.tech/en/research/english-only",
  });
});

test("home, asset and institution metadata use localized entity templates", () => {
  assert.match(homeSeoTitle("en"), /^Tlines Institutional Intelligence/);
  assert.equal(assetSeoTitle("黄金", "zh-CN"), "黄金机构展望与银行预测｜Tlines");
  assert.equal(institutionSeoTitle("UBS", "en"), "UBS Market Outlook, Forecasts & Research | Tlines");
});
