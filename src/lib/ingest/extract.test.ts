import assert from "node:assert/strict";
import test from "node:test";
import { extractArticle, extractFeedLinks, extractLinks, extractPaginationLinks, extractPdfCandidates, extractPdfLinks, inferPublicationDate, isAccessGateText, isBroadcastOrEvent, looksLikeArticle, looksLikeResearchTopic, newestByPublication } from "./extract";
import { articleAllowed, candidateAllowed, listingUrls, refreshKnownCandidate, sitemapEnabled, sitemapUrls } from "./sourceRules";
import { stripTrailingDisclaimerSegments } from "../articleText";

test("captures inline figures in document order and anchors them to body segments", () => {
  const lead = "Our tactical allocation framework blends quantitative signals with fundamental overlays. ".repeat(6);
  const tail = "We reduced the long-duration Treasury overweight and rotated into credit exposure this quarter. ".repeat(6);
  const article = extractArticle(
    `<html><head><title>Quant-anchored TAA | Bank</title></head><body><main><article><h1>Quant-anchored TAA</h1>` +
      `<p>${lead}</p>` +
      `<figure><img src="/images/exhibit-9.png" alt="Relative value fixed income sleeve"><figcaption>Exhibit 9: Relative value fixed income sleeve</figcaption></figure>` +
      `<h2>Active adjustments</h2><p>${tail}</p>` +
      `<img src="tracking/pixel.gif" alt="">` +
      `<img src="https://cdn.example.com/exhibit-11.jpg" alt="TAA model portfolio adjustment">` +
      `</article></main></body></html>`,
    "https://www.bank.com/insights/quant-anchored-taa",
  );
  assert.equal(article.figures.length, 2);
  assert.deepEqual(article.figures[0], {
    url: "https://www.bank.com/images/exhibit-9.png",
    afterSegmentPosition: 0,
    alt: "Relative value fixed income sleeve",
    caption: "Exhibit 9: Relative value fixed income sleeve",
  });
  assert.equal(article.figures[1].url, "https://cdn.example.com/exhibit-11.jpg");
  assert.equal(article.figures[1].afterSegmentPosition, 1);
});

test("excludes author headshots and other non-explanatory images", () => {
  const body = "The framework blends quantitative signals with fundamental overlays across asset classes. ".repeat(8);
  const article = extractArticle(
    `<html><head><title>Report | Bank</title></head><body><main><article><h1>Report</h1>` +
      `<p>${body}</p>` +
      `<figure><img src="https://cdn.example.com/charts/exhibit-1.png" alt="Chart"><figcaption>Exhibit 1</figcaption></figure>` +
      `<div class="author-bio"><img src="https://cdn.example.com/people/jane-doe.jpg" alt="Jane Doe"></div>` +
      `<h2>Authors</h2><div class="team"><img src="https://cdn.example.com/john-smith.jpg" alt="John Smith"></div>` +
      `<img src="https://cdn.example.com/headshot-bob.jpg" alt="Bob">` +
      `</article></main></body></html>`,
    "https://www.bank.com/insights/report",
  );
  assert.deepEqual(article.figures.map((figure) => figure.url), ["https://cdn.example.com/charts/exhibit-1.png"]);
});

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

test("prefers a real h1 when publisher open graph metadata is only a URL slug", () => {
  const prose = "Cross-border investment and trade flows are expanding as supply chains diversify. ".repeat(12);
  const article = extractArticle(`<html><head><meta property="og:title" content="corridors-in-focus-us-india"></head><body><main><h1>US-India: Enabling the next wave of corporate growth</h1><p>${prose}</p></main></body></html>`);
  assert.equal(article.title, "US-India: Enabling the next wave of corporate growth");
});

test("preserves a dated subtitle confirmed by the semantic headline", () => {
  const prose = "Global equities gained while bond markets focused on changing rate expectations. ".repeat(20);
  const article = extractArticle(`<html><head><meta property="og:title" content="Monthly markets review - August 2026"><script type="application/ld+json">{"@type":"Article","headline":"Monthly markets review - August 2026","articleBody":"${prose}"}</script></head><body><main><h1>Monthly markets review - August 2026</h1><p>${prose}</p></main></body></html>`);
  assert.equal(article.title, "Monthly markets review - August 2026");
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

test("removes trailing publisher disclaimers from article segments", () => {
  const prose = "Growth is moderating while inflation is easing and bond valuations are improving. ".repeat(12);
  const article = extractArticle(`<article><h1>Market outlook</h1><ul><li>${prose}</li></ul><h2>Questions or comments?</h2><p>This content is marketing material. None of this information constitutes investment advice.</p></article>`);
  assert.match(article.text, /bond valuations are improving/);
  assert.doesNotMatch(article.text, /marketing material/);
  assert.equal(article.segments.length, 1);
  assert.match(article.disclaimerText || "", /marketing material/);

  const translated = stripTrailingDisclaimerSegments([
    { heading: "观点", text: prose },
    { heading: "如有疑问或评论", text: "本内容为营销材料。本网站提供的任何信息均不构成投资建议。" },
  ]);
  assert.equal(translated.length, 1);

  const generic = stripTrailingDisclaimerSegments([
    { heading: null, text: prose },
    { heading: "Important information", text: "This report is for informational purposes only and does not constitute investment advice. Its accuracy and completeness are not guaranteed." },
  ]);
  assert.equal(generic.length, 1);
});

test("stops before related-content modules", () => {
  const prose = "Economic growth remains resilient while inflation is easing gradually. ".repeat(14);
  const article = extractArticle(`<article><h1>Economic outlook</h1><p>${prose}</p><h2>Explore the latest from our research</h2><p>Another article title that must not enter this body.</p><h2>Disclaimer</h2><p>This report is for informational purposes only and does not constitute investment advice.</p></article>`);
  assert.match(article.text, /inflation is easing/);
  assert.doesNotMatch(article.text, /Another article title/);
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

test("keeps research inside layout containers whose class contains promotion", () => {
  const prose = "High yield credit quality improved as sector concentration fell and issuer demand broadened. ".repeat(30);
  const article = extractArticle(`<main><article><h1>High Yield's Second Act</h1><div class="grid-container cmp-grid-container--2col-promotion"><div class="cmp-text"><p>${prose}</p></div></div></article></main>`);
  assert.match(article.text, /credit quality improved/);
  assert.equal(looksLikeArticle(article.title, article.text), true);
});

test("keeps research pages wrapped in a publisher ASP.NET form", () => {
  const prose = "Eurozone growth remained resilient while inflation and monetary policy shaped the market outlook. ".repeat(30);
  const article = extractArticle(`<main><form id="form1"><div class="main-content"><h1>Eurozone pulls level with the US</h1><p>${prose}</p></div></form></main>`);
  assert.match(article.text, /Eurozone growth remained resilient/);
  assert.equal(looksLikeArticle(article.title, article.text), true);
});

test("recognizes publisher consent copy and excludes author profile links", () => {
  assert.equal(isAccessGateText("Natixis S.A. and its CIB entities worldwide as the Data Controllers use cookies. You can give or not your consent."), true);
  const links = extractLinks(`<a href="/author/171022">Read the complete author profile and publications</a><a href="/Site/en/publication/market-outlook-for-global-investors">Market outlook for global institutional investors</a>`, "https://research.example/Site/");
  assert.deepEqual(links.map((link) => link.url), ["https://research.example/Site/en/publication/market-outlook-for-global-investors"]);
});

test("rejects webinar / broadcast invitations but keeps written research", () => {
  // The exact page that slipped in: a Nordea webinar invite dated in the future.
  const webinar = "The global economy has shown remarkable resilience, but uncertainty remains high. Join Helge J. Pedersen as he explores the key forces shaping the economy in the years ahead. Date: 2 September 2026 Time: 11:00 CET Duration: 30 minutes plus Q&A Language: English";
  assert.equal(isBroadcastOrEvent("Nordea Economic Outlook September 2026", webinar), true);
  assert.equal(isBroadcastOrEvent("Q3 Markets Podcast", "Listen to the episode as our strategists discuss rates and FX."), true);
  assert.equal(isBroadcastOrEvent("On-demand webcast: the year ahead", "Watch the replay of our outlook discussion."), true);
  assert.equal(isBroadcastOrEvent("Market outlook blog", "In this blog, our strategist discusses inflation."), true);
  // A genuine written outlook that merely mentions durations/time in prose must survive.
  const research = "Time: 11:00 CET. Duration: 30 minutes. Our base case sees GDP growth of 1.8% next year as inflation cools. We expect the central bank to hold rates through the second quarter before easing. Equity valuations remain stretched relative to bonds, and we stay neutral on duration while favouring quality credit.";
  assert.equal(isBroadcastOrEvent("2027 Economic Outlook", research), false);
  assert.equal(isBroadcastOrEvent("Asset Class Returns Forecasts", "The brief widening episode was quickly reversed. Follow our podcasts for separate interviews."), false);
  assert.equal(isBroadcastOrEvent("Food inflation in Canada", "A written analysis. To view this video please enable JavaScript. The report continues with six questions about grocery prices."), false);
});

test("applies durable source discovery exceptions", () => {
  assert.deepEqual(listingUrls("commonwealth", "https://www.commbank.com.au/institutional/economic-insight.html"), [
    "https://www.commbank.com.au/institutional/economic-insight.html",
    "https://www.commbank.com.au/articles/newsroom.html",
  ]);
  assert.equal(candidateAllowed("commonwealth", "https://www.commbank.com.au/articles/newsroom/2026/08/rates.html"), true);
  assert.equal(candidateAllowed("commonwealth", "https://www.commbank.com.au/products/rates.html"), false);
  assert.equal(candidateAllowed("natixis", "https://www.research.natixis.com/author/171022"), false);
  assert.equal(sitemapEnabled("intesa"), false);
  assert.equal(sitemapEnabled("kkr"), true);
  assert.equal(articleAllowed("commonwealth", "Market wrap", "Some of the content presented in this section has been provided by Australian Associated Press (AAP)."), false);
  assert.equal(articleAllowed("commonwealth", "Rates outlook", "New Commonwealth Bank Economic research forecasts a November rate rise."), true);
  assert.equal(articleAllowed("commonwealth", "CommBank reduces merchant fees", "Support for business merchants"), false);
  assert.equal(articleAllowed("invesco", "Market and economic insights", "A topic collection"), false);
  assert.equal(articleAllowed("nordea", "Stock exchange release: Half-year report 2026 for Nordea Hypotek AB published", "Issuer report"), false);
  assert.equal(candidateAllowed("schroders", "https://www.schroders.com/en-au/au/individual/insights/market-view/"), true);
  assert.equal(candidateAllowed("schroders", "https://www.schroders.com/en-au/au/individual/funds/global-shares/example/"), false);
  assert.deepEqual(sitemapUrls("schroders"), ["https://www.schroders.com/en/global/individual/sitemap.xml"]);
  assert.equal(refreshKnownCandidate("schroders", "Monthly markets review"), true);
  assert.equal(refreshKnownCandidate("schroders", "Monthly markets review - August 2026"), false);
  assert.equal(candidateAllowed("cr-dit-cib", "https://www.ca-cib.com/en/news/project-finance-transaction"), false);
  assert.equal(candidateAllowed("cr-dit-cib", "https://www.ca-cib.com/en/insights/global-markets-research"), true);
  assert.equal(candidateAllowed("saxo", "https://www.home.saxo/insights/saxostrats-experts"), false);
  assert.equal(candidateAllowed("saxo", "https://www.home.saxo/content/articles/macro/market-update"), true);
  assert.equal(candidateAllowed("nab-markets", "https://business.nab.com.au/tag/small-business/founder-story"), false);
  assert.equal(candidateAllowed("nab-markets", "https://business.nab.com.au/tag/economic-commentary/nab-outlook"), true);
  assert.equal(articleAllowed("seb", "Investment Outlook Reports", "A report listing"), false);
  assert.equal(articleAllowed("rbc", "Featured Analysis", "A collection of featured reports"), false);
  assert.equal(articleAllowed("commerzbank", "Newsletters | Corporate Clients", "Newsletter archive"), false);
  assert.equal(articleAllowed("citi", "View Transcript", "A complete podcast transcript with substantive research."), true);
  assert.equal(candidateAllowed("rabobank", "https://www.rabobank.com/knowledge/q011543889-seven-so-far-seven-more-to-come"), true);
  assert.equal(candidateAllowed("rabobank", "https://www.rabobank.com/knowledge/all-articles"), false);
  assert.equal(articleAllowed("bmo", "BMO Named Official Bank of the Los Angeles Lakers", "Sponsorship announcement"), false);
  // Newly registered sub-topic listing pages are crawled alongside the main research URL.
  // Pinned to a day because the extras rotate; the sections themselves are asserted by
  // the rotation test rather than by their order here.
  const nomura = listingUrls("nomura", "https://www.nomuraconnects.com/about-asia", 0);
  assert.equal(nomura[0], "https://www.nomuraconnects.com/about-asia");
  for (const section of ["economics", "emerging-markets", "annual-outlook", "rates", "sustainability"]) {
    assert.ok(nomura.includes(`https://www.nomuraconnects.com/${section}`), `${section} is crawled`);
  }
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
    <div id="RSS"><a title="RSS: Eco Week" href="/RSS/en-US/Eco-Week">Eco Week</a></div>
    <a href="https://feeds.vendor.example/bank.xml">External feed</a>`;
  assert.deepEqual(extractFeedLinks(html, "https://bank.example/research"), [
    "https://bank.example/insights/feed.xml",
    "https://bank.example/research/atom.xml",
    "https://bank.example/RSS/en-US/Eco-Week",
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

test("discovers articles and full bodies in public structured JSON", () => {
  const body = "Growth is slowing while inflation is easing. Bond yields remain volatile and policy normalization will be gradual. ".repeat(12);
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    headline: "Monthly global market outlook for institutional investors",
    url: "/insights/2026/08/monthly-global-market-outlook",
    datePublished: "2026-08-27",
    articleBody: body,
  })}</script>`;
  assert.equal(extractLinks(html, "https://bank.example/insights")[0]?.publishedAt?.toISOString().slice(0, 10), "2026-08-27");
  const article = extractArticle(html);
  assert.equal(article.title, "Monthly global market outlook for institutional investors");
  assert.match(article.text, /policy normalization/);
});

test("discovers article links exposed by web-component card metadata", () => {
  const html = `<jb-article-card
    link='{"href":"/en/insights/market-insights/rates/higher-bond-yields/"}'
    teaserheader='{"headline":"Can equities withstand higher bond yields?"}'
    teasermeta='{"date":"02.09.2026"}'></jb-article-card>`;
  assert.deepEqual(extractLinks(html, "https://example.com/en/insights/"), [{
    url: "https://example.com/en/insights/market-insights/rates/higher-bond-yields/",
    title: "Can equities withstand higher bond yields?",
    publishedAt: new Date("2026-09-02T00:00:00.000Z"),
  }]);
});

test("follows only explicit same-origin listing pagination", () => {
  const html = `<a rel="next" href="/insights?page=2">Next</a><a href="https://vendor.example/insights?page=2">Next</a><a href="/careers?page=2">Next</a>`;
  assert.deepEqual(extractPaginationLinks(html, "https://bank.example/insights?page=1", "https://bank.example/insights"), ["https://bank.example/insights?page=2"]);
});

test("bullet lists survive extraction, short items included", () => {
  const lead = "Policy is restrictive and the committee has signalled patience through the autumn. ".repeat(5);
  const tail = "We keep the front end anchored and add duration on any concession into the auction. ".repeat(5);
  const article = extractArticle(
    `<html><head><title>Rates outlook | Bank</title></head><body><main><article><h1>Rates outlook</h1>` +
      `<p>${lead}</p>` +
      `<ul><li>Cut in December</li><li>Terminal rate 3.25%</li><li>Balance sheet runoff continues through the first quarter of next year</li></ul>` +
      `<p>${tail}</p>` +
      `</article></main></body></html>`,
    "https://bank.example/research/rates-outlook",
  );
  const body = article.segments.map((segment) => segment.text).join("\n\n");
  // Each item is marked so the page can lay the list out again, and the two short ones
  // are kept — the length rule exists to drop navigation, not three-word forecasts.
  assert.match(body, /• Cut in December/);
  assert.match(body, /• Terminal rate 3\.25%/);
  assert.match(body, /• Balance sheet runoff continues/);
});

test("recordings are excluded wherever they are published, articles are not", () => {
  const rejected = [
    "https://www.ib.barclays/our-insights/the-flip-side-podcast/if-the-fed-goes-quiet.html",
    "https://cibccm.com/en/insights/podcasts/economic-insights-for-institutional-investors/",
    "https://bank.example/research/video/market-update",
    "https://bank.example/insights/webinar-outlook-2026",
    "https://bank.example/episodes/42",
  ];
  for (const url of rejected) {
    assert.equal(candidateAllowed("barclays", url), false, `${url} is a recording`);
  }

  // A written report must survive, including one whose words merely contain a rejected
  // one — "watchlist" and "Podcaster" are not recordings.
  const kept = [
    "https://www.ib.barclays/our-insights/barclays-brief/ai-goes-economy-wide.html",
    "https://www.ib.barclays/our-insights/3-point-perspective/hedge-fund-outlook-2026.html",
    "https://bank.example/research/fed-watchlist-september",
    "https://bank.example/research/videography-market-note",
  ];
  for (const url of kept) {
    assert.equal(candidateAllowed("barclays", url), true, `${url} is a report`);
  }
});

test("a six-digit date is read the way that does not fall in the future", () => {
  // 260828 is 28 August 2026 written year-first, not 26 August 2028. Read the other way
  // the report is dated two years ahead and discarded as never published.
  assert.deepEqual(
    inferPublicationDate("https://bank.example/publications/260828-wif-economic-cycle-e.html"),
    new Date("2026-08-28T00:00:00.000Z"),
  );
  // Day-first still works where that is the reading that lands in the past.
  assert.deepEqual(
    inferPublicationDate("https://bank.example/notes/280826-outlook.html"),
    new Date("2026-08-28T00:00:00.000Z"),
  );
});

test("discovers Danske UUID article routes", () => {
  const html = `<main><div class="card"><img alt="Right Arrow"><p>2.9.2026</p><p>Euro Area Macro Monitor - Growth resilience takes rate cuts off the table</p><a href="/research/article/5d0bf2b0-3d66-44bc-80a5-09358f838cf6/EN">Read more</a></div></main>`;
  const link = extractLinks(html, "https://research.danskebank.com/research/home")[0];
  assert.equal(link?.url, "https://research.danskebank.com/research/article/5d0bf2b0-3d66-44bc-80a5-09358f838cf6/EN");
  assert.equal(link?.title, "Euro Area Macro Monitor - Growth resilience takes rate cuts off the table");
});

test("continental dotted dates are understood", () => {
  assert.deepEqual(inferPublicationDate("Veröffentlicht am 02.09.2026"), new Date("2026-09-02T00:00:00.000Z"));
  assert.deepEqual(inferPublicationDate("31.12.2025"), new Date("2025-12-31T00:00:00.000Z"));
});

test("listings rotate so every section is reached across runs", () => {
  const research = "https://www.nomuraconnects.com/articles";
  const first = listingUrls("nomura", research, 0);
  assert.equal(first[0], research, "the source's own page stays first");

  const sections = first.slice(1);
  assert.ok(sections.length > 3, "this publisher has more sections than one run visits");

  // Each day starts the extras at a different point, and no run loses or repeats one.
  for (const day of [0, 1, 5, sections.length, sections.length + 3]) {
    const order = listingUrls("nomura", research, day);
    assert.equal(order[0], research);
    assert.deepEqual([...order.slice(1)].sort(), [...sections].sort(), `day ${day} covers every section once`);
  }

  // A run reads only its first few pages, so what those are has to change by the day.
  const headOne = listingUrls("nomura", research, 1).slice(1, 4);
  const headTwo = listingUrls("nomura", research, 2).slice(1, 4);
  assert.notDeepEqual(headOne, headTwo, "consecutive days must not read the same sections");
});

test("a source without extra listings is unaffected by rotation", () => {
  const only = listingUrls("no-such-source", "https://bank.example/research");
  assert.deepEqual(only, ["https://bank.example/research"]);
});

test("months are read abbreviated as well as in full", () => {
  // "02 Sep 2026" is among the commonest forms a publisher uses; only full names were
  // matched, so those reports carried no date and were treated as undated.
  for (const text of ["02 Sep 2026", "Sep 2, 2026", "2 Sept 2026", "2 September 2026", "September 2, 2026"]) {
    assert.deepEqual(inferPublicationDate(text), new Date("2026-09-02T00:00:00.000Z"), text);
  }
  assert.deepEqual(inferPublicationDate("15 Aug 2026"), new Date("2026-08-15T00:00:00.000Z"));
  assert.deepEqual(inferPublicationDate("Jan 9, 2026"), new Date("2026-01-09T00:00:00.000Z"));
});

test("a word that merely begins like a month is not a date", () => {
  // "Marathon" starts with "mar" and "Mayor" with "may"; neither states a day.
  assert.equal(inferPublicationDate("Marathon 12 2026 report"), null);
  assert.equal(inferPublicationDate("Mayor 3 2026 speech"), null);
});

test("a date is found even where a card runs its words together", () => {
  // Card text arrives without spaces between elements — "View24 August 2026" — so a word
  // boundary before the day is the wrong guard: there is none between "w" and "2".
  assert.deepEqual(inferPublicationDate("Weekly Macro View24 August 2026Download PDF"), new Date("2026-08-24T00:00:00.000Z"));
  assert.deepEqual(inferPublicationDate("Macroeconomics · 02 Sep 2026Barometer"), new Date("2026-09-02T00:00:00.000Z"));
  // A day inside a longer number is still not a day.
  assert.equal(inferPublicationDate("reference 1234 August 2026"), null);
});
