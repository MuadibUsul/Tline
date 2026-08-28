import assert from "node:assert/strict";
import test from "node:test";
import { extractArticle, extractFeedLinks, extractLinks, extractPdfCandidates, extractPdfLinks, inferPublicationDate, looksLikeArticle, looksLikeResearchTopic, newestByPublication } from "./extract";

test("extracts an embedded publisher date and conservative URL date hints", () => {
  const article = extractArticle(`<html><head><title>CIO Insights 4Q24 | Bank</title></head><body>
    <main><h1>CIO Insights 4Q24</h1><p>${"A substantive research sentence. ".repeat(20)}</p></main>
    <script type="application/json">{"PublishedDate":"30 Sep 2024"}</script>
  </body></html>`);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2024-09-30");
  assert.equal(inferPublicationDate("cio-insights-4q24")?.toISOString().slice(0, 10), "2024-10-01");
  assert.equal(inferPublicationDate("market-view-2026-08-20")?.toISOString().slice(0, 10), "2026-08-20");
  assert.equal(inferPublicationDate("/insights/2026/08/market-outlook"), null);
  assert.equal(inferPublicationDate("latest-26082026.html")?.toISOString().slice(0, 10), "2026-08-26");
  assert.equal(inferPublicationDate("scotia-flash.-august-23--2026-.html")?.toISOString().slice(0, 10), "2026-08-23");
  assert.equal(inferPublicationDate("DTO%20270826.pdf")?.toISOString().slice(0, 10), "2026-08-27");
  assert.equal(inferPublicationDate("Weekly%20Macro%20View%2024%20August%202026.pdf")?.toISOString().slice(0, 10), "2026-08-24");
  assert.equal(inferPublicationDate("/2026/business-view", "Monday 22 June")?.toISOString().slice(0, 10), "2026-06-22");
  assert.equal(inferPublicationDate("Emerging Markets July 22, 2026")?.toISOString().slice(0, 10), "2026-07-22");
  assert.equal(inferPublicationDate("economic_monthly_ASEANIndiaau20260820e.pdf")?.toISOString().slice(0, 10), "2026-08-20");
  assert.equal(inferPublicationDate("market-view-latest"), null);
  assert.equal(extractArticle(`<title>Daily: Navigating higher long-end yields | UBS</title><main><p>${"Bond markets remain volatile. ".repeat(20)}</p></main>`).title, "Daily: Navigating higher long-end yields");
});

test("does not truncate a long article body", () => {
  const body = Array.from({ length: 700 }, (_, index) => `<p>Paragraph ${index} contains enough substantive institutional research text to retain.</p>`).join("");
  const article = extractArticle(`<html><head><title>Long report</title></head><body><article>${body}</article></body></html>`);
  assert.ok(article.text.length > 16_000);
  assert.match(article.text, /Paragraph 699/);
});

test("does not reject prose because it contains a long source URL", () => {
  const prose = `${"Economic activity remains resilient. Inflation is easing gradually. Policy rates remain restrictive. Markets expect measured normalization. ".repeat(20)} https://www.example.com/community-social-impact/reporting-performance/index.html.`;
  assert.equal(looksLikeArticle("Monthly economic outlook", prose), true);
});

test("rejects legal disclosures presented as the article body", () => {
  const disclosure = [
    "This material is being provided for informational purposes only and does not constitute an offer to sell any investment product.",
    "Past investment performance is not reflective of future results and no representation is made that these views are correct.",
    "A word about risk: All investments contain risk and may lose value. Market and liquidity conditions can change without prior notice.",
    "This material should not be considered as investment advice. No part of this material may be reproduced without express permission.",
  ].join("\n\n").repeat(4);
  assert.equal(looksLikeArticle("Market outlook", disclosure), false);

  const research = `${"Growth is moderating while inflation is easing. Bond valuations now compensate investors for duration risk. Policy normalization should remain gradual. Portfolio diversification remains important. ".repeat(35)}\n\n${disclosure}`;
  assert.equal(looksLikeArticle("Market outlook", research), true);
});

test("distinguishes investment research PDFs from operational vendor notices", () => {
  assert.equal(looksLikeResearchTopic(
    "Global bond outlook",
    "Economic growth is slowing as inflation moderates. Bond yields and market valuations now offer investors better portfolio opportunities.",
  ), true);
  assert.equal(looksLikeResearchTopic(
    "ERP and TMS vendor newsletter",
    "File upload specifications will change. Vendors should migrate customer payment files to the new XML interface before the technical deadline.",
  ), false);
  assert.equal(looksLikeResearchTopic(
    "Labour market update",
    "Employment growth slowed as job creation weakened. Wage pressures are easing while unemployment has moved higher.",
  ), true);
});

test("keeps semantic content when body and main class names mention cookie or nav", () => {
  const prose = "Market demand remains strong. Revenue growth accelerated this quarter. Margins remain resilient. Risks are concentrated in supply constraints. ".repeat(18);
  const article = extractArticle(`<html><head><title>Semiconductor outlook</title></head><body class="cookie-disclaimer-accepted"><div class="page-content ad-banner-color"><main class="nav-modifiers-tabs"><article><h1>Semiconductor outlook</h1><p>${prose}</p></article></main></div></body></html>`);
  assert.match(article.text, /Market demand remains strong/);
  assert.equal(looksLikeArticle(article.title, article.text), true);
});

test("discovers nested article pages and embedded same-origin PDFs", () => {
  const base = "https://bank.example/about/economics/publications.html";
  const html = `<a href="/about/economics/publications/2025/market-review-from-last-year">A sufficiently descriptive older research publication</a>
    <a href="/about/economics/publications/post.daily.august-26-2026.html">A sufficiently descriptive daily research publication</a>
    <a href="/about/economics/publications-news/gir">A long headline must not make a sibling path look like the configured section</a>
    <footer><a href="/investors/credit-ratings-fixed-income/">A sufficiently descriptive investor-relations footer link</a></footer>
    <iframe src="/documents/report.pdf"></iframe><footer><a href="/documents/modern-slavery-statement.pdf">Modern slavery statement</a></footer><a href="https://cdn.example/report.pdf">external PDF</a>`;
  assert.deepEqual(extractLinks(html, base).map((link) => link.url), [
    "https://bank.example/about/economics/publications/post.daily.august-26-2026.html",
    "https://bank.example/about/economics/publications/2025/market-review-from-last-year",
  ]);
  assert.deepEqual(extractPdfLinks(html, base), ["https://bank.example/documents/report.pdf"]);
});

test("discovers same-origin publisher RSS and Atom feeds", () => {
  const html = `<link rel="alternate" type="application/rss+xml" href="/insights/feed.xml">
    <a href="https://bank.example/research/atom.xml">Research feed</a>
    <a href="https://feeds.vendor.example/bank.xml">External feed</a>`;
  assert.deepEqual(extractFeedLinks(html, "https://bank.example/research"), [
    "https://bank.example/insights/feed.xml",
    "https://bank.example/research/atom.xml",
  ]);
});

test("retains title and card date for direct research PDF links", () => {
  const candidates = extractPdfCandidates(`<article><h3>Weekly Macro View</h3><time>24 August 2026</time><a href="/reports/macro.pdf">Download PDF</a></article>`, "https://bank.example/research");
  assert.equal(candidates[0].title, "Weekly Macro View");
  assert.equal(candidates[0].publishedAt?.toISOString().slice(0, 10), "2026-08-24");
});

test("uses a card heading when the article link is a short CTA", () => {
  const links = extractLinks(`
    <main><article class="research-card"><h3>Quarterly Global Investment Outlook for institutional investors</h3>
      <a href="/research/quarterly-global-outlook.page">Read more</a></article></main>
  `, "https://bank.example/research/index.page");
  assert.deepEqual(links, [{
    url: "https://bank.example/research/quarterly-global-outlook.page",
    title: "Quarterly Global Investment Outlook for institutional investors",
    publishedAt: null,
  }]);
});

test("accepts article cards with misleading contentinfo roles and long combined headlines", () => {
  const links = extractLinks(`
    <article role="contentinfo"><a href="/insights/2026/08/current-outlook-for-global-markets-and-investors">
      Current outlook for global markets and investors ${"Detailed standfirst text. ".repeat(12)} 28 August 2026
    </a></article>
  `, "https://bank.example/insights");
  assert.equal(links.length, 1);
  assert.ok(links[0].title.length <= 240);
});

test("reads a visible publication date when metadata is absent", () => {
  const article = extractArticle(`<html><head><title>Global market outlook</title></head><body><article>
    <div class="publication-date">28 August 2026</div>
    <p>${"Growth is slowing while inflation is easing and bond markets expect gradual policy normalization. ".repeat(20)}</p>
  </article></body></html>`);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2026-08-28");
});

test("extracts JSON publication dates and div-only client-rendered prose", () => {
  const prose = "Growth is slowing while inflation is easing. Bond yields remain volatile and policy normalization will be gradual. ".repeat(12);
  const article = extractArticle(`<html><head><title>Global market outlook</title></head><body><main>
    <script type="application/json">{"publishDateStr":"April 15, 2026"}</script>
    <div class="article-content"><div>${prose}</div></div>
  </main></body></html>`);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2026-04-15");
  assert.match(article.text, /Bond yields remain volatile/);
  assert.equal(looksLikeArticle(article.title, article.text), true);
});

test("keeps a publication date rendered inside stripped page chrome", () => {
  const article = extractArticle(`<html><head><title>Global market outlook</title></head><body>
    <header><time datetime="2026-08-14T00:00:00Z">14 August 2026</time></header>
    <article><p>${"Growth is slowing while inflation is easing and markets expect gradual normalization. ".repeat(20)}</p></article>
  </body></html>`);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2026-08-14");
});

test("selects newest accepted articles after all discovery channels run", () => {
  const selected = newestByPublication([
    { title: "pinned old", publishedAt: new Date("2023-04-01") },
    { title: "current", publishedAt: new Date("2026-08-20") },
    { title: "recent", publishedAt: new Date("2026-07-10") },
  ], 2);
  assert.deepEqual(selected.map((article) => article.title), ["current", "recent"]);
});
