import assert from "node:assert/strict";
import test from "node:test";
import { extractArticle, extractLinks, extractPdfLinks, inferPublicationDate, looksLikeArticle } from "./extract";

test("extracts an embedded publisher date and conservative URL date hints", () => {
  const article = extractArticle(`<html><head><title>CIO Insights 4Q24 | Bank</title></head><body>
    <main><h1>CIO Insights 4Q24</h1><p>${"A substantive research sentence. ".repeat(20)}</p></main>
    <script type="application/json">{"PublishedDate":"30 Sep 2024"}</script>
  </body></html>`);
  assert.equal(article.publishedAt?.toISOString().slice(0, 10), "2024-09-30");
  assert.equal(inferPublicationDate("cio-insights-4q24")?.toISOString().slice(0, 10), "2024-10-01");
  assert.equal(inferPublicationDate("market-view-2026-08-20")?.toISOString().slice(0, 10), "2026-08-20");
  assert.equal(inferPublicationDate("latest-26082026.html")?.toISOString().slice(0, 10), "2026-08-26");
  assert.equal(inferPublicationDate("scotia-flash.-august-23--2026-.html")?.toISOString().slice(0, 10), "2026-08-23");
  assert.equal(inferPublicationDate("DTO%20270826.pdf")?.toISOString().slice(0, 10), "2026-08-27");
  assert.equal(inferPublicationDate("Weekly%20Macro%20View%2024%20August%202026.pdf")?.toISOString().slice(0, 10), "2026-08-24");
  assert.equal(inferPublicationDate("market-view-latest"), null);
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

test("keeps semantic content when body and main class names mention cookie or nav", () => {
  const prose = "Market demand remains strong. Revenue growth accelerated this quarter. Margins remain resilient. Risks are concentrated in supply constraints. ".repeat(18);
  const article = extractArticle(`<html><head><title>Semiconductor outlook</title></head><body class="cookie-disclaimer-accepted"><div class="page-content ad-banner-color"><main class="nav-modifiers-tabs"><article><h1>Semiconductor outlook</h1><p>${prose}</p></article></main></div></body></html>`);
  assert.match(article.text, /Market demand remains strong/);
  assert.equal(looksLikeArticle(article.title, article.text), true);
});

test("discovers nested article pages and embedded same-origin PDFs", () => {
  const base = "https://bank.example/about/economics/publications.html";
  const html = `<a href="/about/economics/publications/post.daily.august-26-2026.html">A sufficiently descriptive daily research publication</a>
    <iframe src="/documents/report.pdf"></iframe><a href="https://cdn.example/report.pdf">external PDF</a>`;
  assert.equal(extractLinks(html, base)[0]?.url, "https://bank.example/about/economics/publications/post.daily.august-26-2026.html");
  assert.deepEqual(extractPdfLinks(html, base), ["https://bank.example/documents/report.pdf"]);
});
