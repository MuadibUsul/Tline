#!/usr/bin/env node

const base = new URL(process.argv.find((value) => value.startsWith("--base="))?.slice(7) || "https://tlines.tech");
const canonicalOrigin = new URL(process.argv.find((value) => value.startsWith("--canonical-origin="))?.slice(19) || process.env.SITE_URL || "https://tlines.tech");
const sampleLimit = Math.max(6, Number(process.argv.find((value) => value.startsWith("--sample="))?.slice(9) || 24));
const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const googleUa = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const decode = (value) => value
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? "")]));
const normalizedUrl = (value) => value ? new URL(value, base).toString().replace(/\/$/, "") : "";
const fetchUrl = (value) => {
  const canonical = new URL(value, canonicalOrigin);
  return canonical.origin === base.origin ? canonical.toString() : new URL(`${canonical.pathname}${canonical.search}`, base).toString();
};
const text = (html) => decode(html
  .replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

function pageMeta(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => attrs(match[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attrs(match[0]));
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  const h1 = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const canonical = links.find((link) => (link.rel || "").toLowerCase().split(/\s+/).includes("canonical"))?.href || "";
  const alternates = links.filter((link) => (link.rel || "").toLowerCase().split(/\s+/).includes("alternate") && link.hreflang)
    .map((link) => ({ hreflang: link.hreflang, href: link.href }));
  const robots = metas.find((meta) => (meta.name || "").toLowerCase() === "robots")?.content || "";
  const visible = text(html);
  return {
    title, h1, canonical, alternates, robots, visibleChars: visible.length,
    soft404: /(?:\b404\b|not found|page does not exist|页面不存在|未找到)/i.test(`${title} ${h1} ${visible.slice(0, 500)}`),
    pdfPreview: /\/api\/documents\//i.test(html),
    completeEnglishSource: /Complete English original/i.test(visible),
  };
}

async function request(url, userAgent = googleUa, redirect = "manual") {
  const started = Date.now();
  try {
    const response = await fetch(url, { redirect, headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    return {
      url, status: response.status, location: response.headers.get("location") || "", type: response.headers.get("content-type") || "",
      robotsHeader: response.headers.get("x-robots-tag") || "", cache: response.headers.get("cache-control") || "",
      vary: response.headers.get("vary") || "", setCookie: Boolean(response.headers.get("set-cookie")),
      server: response.headers.get("server") || "", cfRay: response.headers.get("cf-ray") || "", ms: Date.now() - started, body,
    };
  } catch (error) {
    return { url, status: 0, location: "", type: "", robotsHeader: "", cache: "", vary: "", setCookie: false, server: "", cfRay: "", ms: Date.now() - started, body: "", error: String(error) };
  }
}

async function chain(path) {
  const hops = [];
  let url = new URL(path, base).toString();
  for (let index = 0; index < 6; index++) {
    const result = await request(url);
    hops.push(result);
    if (result.status < 300 || result.status >= 400 || !result.location) break;
    url = new URL(result.location, url).toString();
  }
  return hops;
}

const xmlValues = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((match) => decode(match[1].trim()));
function sitemapEntries(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => {
    const block = match[1];
    return {
      loc: xmlValues(block, "loc")[0] || "",
      lastmod: xmlValues(block, "lastmod")[0] || "",
      alternates: [...block.matchAll(/<xhtml:link\b[^>]*>/gi)].map((item) => attrs(item[0])).filter((item) => item.hreflang && item.href),
    };
  });
}

function representative(entries) {
  const urls = entries.map((entry) => entry.loc);
  const picks = new Set([new URL("/en", canonicalOrigin).toString(), new URL("/zh", canonicalOrigin).toString(), new URL("/en/research", canonicalOrigin).toString(), new URL("/zh/research", canonicalOrigin).toString()]);
  const groups = ["/en/research/", "/zh/research/", "/en/institution/", "/zh/institution/", "/en/markets/", "/zh/markets/", "/en/topics/", "/zh/topics/", "/en/economies/", "/zh/economies/"];
  const matchesByGroup = groups.map((fragment) => urls.filter((url) => new URL(url).pathname.startsWith(fragment)));
  // Cover every page type and locale before spending the remaining sample budget on the
  // oldest/newest members of larger collections.
  for (const matches of matchesByGroup) if (matches.length) picks.add(matches[Math.floor(matches.length / 2)]);
  for (const matches of matchesByGroup) {
    if (picks.size >= sampleLimit) break;
    if (matches[0]) picks.add(matches[0]);
    if (picks.size >= sampleLimit) break;
    if (matches.at(-1)) picks.add(matches.at(-1));
  }
  return [...picks].filter((url) => urls.includes(url)).slice(0, sampleLimit);
}

const failures = [];
const warnings = [];
const robotsResult = await request(new URL("/robots.txt", base).toString());
const sitemapIndex = await request(new URL("/sitemap.xml", base).toString());
if (robotsResult.status !== 200) failures.push(`robots.txt returned ${robotsResult.status || "an error"}`);
if (sitemapIndex.status !== 200 || !/xml/i.test(sitemapIndex.type)) failures.push(`sitemap.xml returned ${sitemapIndex.status || "an error"} (${sitemapIndex.type || "no content type"})`);

const shardUrls = xmlValues(sitemapIndex.body, "loc");
const shardResults = await Promise.all(shardUrls.map((url) => request(fetchUrl(url))));
const entries = shardResults.flatMap((result) => sitemapEntries(result.body));
const locs = entries.map((entry) => entry.loc);
const locSet = new Set(locs);
const duplicateLocs = locs.length - locSet.size;
const offOrigin = locs.filter((url) => { try { return new URL(url).origin !== canonicalOrigin.origin; } catch { return true; } });
const alternateTargets = entries.flatMap((entry) => entry.alternates.map((alternate) => alternate.href));
const missingAlternates = [...new Set(alternateTargets.filter((url) => !locSet.has(url)))];
const futureLastmod = entries.filter((entry) => entry.lastmod && new Date(entry.lastmod).getTime() > Date.now() + 86_400_000);
if (!shardUrls.length) failures.push("sitemap index contains no shard URLs");
for (const result of shardResults) if (result.status !== 200 || !/xml/i.test(result.type)) failures.push(`${result.url} returned ${result.status} (${result.type})`);
if (duplicateLocs) failures.push(`sitemap contains ${duplicateLocs} duplicate <loc> entries`);
if (offOrigin.length) failures.push(`sitemap contains ${offOrigin.length} off-origin or invalid URLs`);
if (missingAlternates.length) failures.push(`sitemap contains ${missingAlternates.length} alternate targets absent from all <loc> entries`);
if (futureLastmod.length) warnings.push(`sitemap contains ${futureLastmod.length} lastmod values more than 24 hours in the future`);

const disallows = [...robotsResult.body.matchAll(/^\s*Disallow:\s*(\S+)\s*$/gim)].map((match) => match[1]);
const blockedSitemapUrls = locs.filter((url) => disallows.some((rule) => rule !== "/" && new URL(url).pathname.startsWith(rule)));
const researchCounts = {
  en: entries.filter((entry) => /^\/en\/research\//.test(new URL(entry.loc).pathname)).length,
  zh: entries.filter((entry) => /^\/zh\/research\//.test(new URL(entry.loc).pathname)).length,
};
if (blockedSitemapUrls.length) failures.push(`${blockedSitemapUrls.length} sitemap URLs match a robots.txt Disallow rule`);
if (!robotsResult.body.includes(`${canonicalOrigin.origin}/sitemap.xml`)) failures.push("robots.txt does not advertise the canonical sitemap index");

/**
 * `--full-sitemap`: every advertised URL, not a sample.
 *
 * The sampled run below can pass 24/24 while a shard advertises pages that answer `noindex`,
 * or alternates whose targets are not published — both shipped once, and only an exhaustive
 * crawl caught them. One concurrent pass over every <loc> entry: each must answer 200 to
 * Googlebot without redirecting, carry no `noindex`, and name itself canonical at its own
 * path. Slow (one request per URL), so it is opt-in rather than the default run.
 */
let fullSitemapChecked = 0;
let fullSitemapProblems = 0;
if (process.argv.includes("--full-sitemap")) {
  const targets = entries.map((entry) => fetchUrl(entry.loc));
  const problems = [];
  const concurrency = 8;
  for (let index = 0; index < targets.length; index += concurrency) {
    await Promise.all(targets.slice(index, index + concurrency).map(async (url) => {
      try {
        const response = await request(url);
        fullSitemapChecked++;
        if (response.status !== 200) {
          problems.push(`${url}: status ${response.status}${response.location ? ` -> ${response.location}` : ""}`);
          return;
        }
        const meta = pageMeta(response.body);
        if (/noindex/i.test(meta.robots)) problems.push(`${url}: noindex (robots="${meta.robots}")`);
        else if (meta.canonical && meta.canonical !== `${canonicalOrigin.origin}${new URL(url).pathname}`) problems.push(`${url}: canonical=${meta.canonical}`);
      } catch (error) {
        fullSitemapChecked++;
        problems.push(`${url}: ${String(error).slice(0, 80)}`);
      }
    }));
    process.stderr.write(`\rfull sitemap: ${Math.min(index + concurrency, targets.length)}/${targets.length}`);
  }
  process.stderr.write("\n");
  fullSitemapProblems = problems.length;
  // Every problem is a failure; the slice only keeps one pathological shard from burying the
  // rest of the report, and the count in the summary still says how many there are.
  failures.push(...problems.slice(0, 40));
}

const sampledUrls = representative(entries);
const sampled = [];
for (const url of sampledUrls) {
  const target = fetchUrl(url);
  const [browser, google] = await Promise.all([request(target, browserUa), request(target, googleUa)]);
  const browserMeta = pageMeta(browser.body);
  const googleMeta = pageMeta(google.body);
  const issues = [];
  if (google.status !== 200) issues.push(`Googlebot ${google.status || "ERR"}`);
  if (browser.status !== google.status) issues.push(`UA status differs (${browser.status}/${google.status})`);
  if (/noindex/i.test(`${google.robotsHeader} ${googleMeta.robots}`)) issues.push("noindex");
  if (!googleMeta.title) issues.push("missing title");
  if (!googleMeta.h1) issues.push("missing h1");
  if (!googleMeta.canonical) issues.push("missing canonical");
  else if (normalizedUrl(googleMeta.canonical) !== normalizedUrl(url)) issues.push(`canonical mismatch: ${googleMeta.canonical}`);
  if (!googleMeta.alternates.some((alternate) => normalizedUrl(alternate.href) === normalizedUrl(url))) issues.push("hreflang omits self URL");
  if (!googleMeta.alternates.some((alternate) => alternate.hreflang.toLowerCase() === "x-default")) issues.push("missing x-default hreflang");
  if (googleMeta.soft404) issues.push("soft-404 wording");
  if (googleMeta.visibleChars < 200) issues.push(`thin SSR text (${googleMeta.visibleChars})`);
  if (/\/research\//.test(new URL(url).pathname) && googleMeta.visibleChars < 500) issues.push(`thin research SSR text (${googleMeta.visibleChars})`);
  if (/cf-chl-|just a moment|attention required/i.test(google.body)) issues.push("bot challenge body");
  if (Math.abs(browserMeta.visibleChars - googleMeta.visibleChars) > Math.max(300, browserMeta.visibleChars * 0.2)) issues.push("UA body size differs >20%");
  if (issues.length) failures.push(`${url}: ${issues.join(", ")}`);
  sampled.push({ url, browser, google, meta: googleMeta, issues });
}

const edgeCases = [
  { path: "/en/institutions?page=9999", expectation: "404 or noindex", check: (result, meta) => result.status === 404 || /noindex/i.test(`${result.robotsHeader} ${meta.robots}`) },
  { path: "/en/research?page=9999", expectation: "404 or noindex", check: (result, meta) => result.status === 404 || /noindex/i.test(`${result.robotsHeader} ${meta.robots}`) },
  { path: "/en/research?page=2", expectation: "indexable self-canonical pagination with onward links", check: (result, meta) => result.status === 200 && !/noindex/i.test(`${result.robotsHeader} ${meta.robots}`) && normalizedUrl(meta.canonical) === normalizedUrl(new URL("/en/research?page=2", canonicalOrigin)) && /href="\/en\/research\?page=3"/.test(result.body) },
  { path: "/en/markets/SPX", expectation: "redirect to canonical slug", check: (result) => result.status >= 300 && result.status < 400 && Boolean(result.location) },
  { path: "/sitemap/0.xml", expectation: "redirect to a named canonical sitemap", check: (result) => result.status === 308 && /\/sitemap\/pages-en\.xml$/.test(new URL(result.location, result.url).pathname) },
  { path: "/api/documents/not-a-document", expectation: "non-HTML response with X-Robots-Tag noindex", check: (result) => /noindex/i.test(result.robotsHeader) },
];
const edgeResults = [];
for (const edge of edgeCases) {
  const result = await request(new URL(edge.path, base).toString());
  const meta = pageMeta(result.body);
  const pass = edge.check(result, meta);
  if (!pass) failures.push(`${result.url}: expected ${edge.expectation}; got ${result.status}, robots=${meta.robots || result.robotsHeader || "implicit index"}, canonical=${meta.canonical || "none"}`);
  edgeResults.push({ ...edge, result, meta, pass });
}

const sampledPdfResearch = sampled.filter((row) => row.meta.pdfPreview && !row.meta.completeEnglishSource);
if (sampledPdfResearch.length) warnings.push(`${sampledPdfResearch.length} sampled research pages use a PDF preview without the complete English source text in server HTML; structured editorial text is present, but information-gain quality remains a manual review item`);

const redirectPaths = ["/", "/research", "/zh/sitemap.xml", "/cn/research"];
const redirects = await Promise.all(redirectPaths.map(chain));
for (const hops of redirects) {
  const final = hops.at(-1);
  if (!final || final.status !== 200) failures.push(`${hops[0]?.url}: redirect chain ended at ${final?.status || "ERR"}`);
  if (hops.length > 2) warnings.push(`${hops[0]?.url}: ${hops.length - 1} redirect hops`);
}

const cfSignals = [robotsResult, sitemapIndex, ...shardResults, ...sampled.flatMap((row) => [row.browser, row.google])];
const cfObserved = cfSignals.some((result) => result.cfRay || /cloudflare/i.test(result.server));
const challengeObserved = cfSignals.some((result) => [403, 429, 503].includes(result.status) || /cf-chl-|just a moment|attention required/i.test(result.body));
if (challengeObserved) failures.push("a sampled request encountered a block/rate-limit/challenge response");
if (!cfObserved) warnings.push("no Cloudflare response headers observed; dashboard/WAF configuration remains待验证");

console.log(`# Tlines SEO baseline\n\nGenerated: ${new Date().toISOString()}  \nBase: ${base.origin}  \nCanonical origin: ${canonicalOrigin.origin}  \nCommand: \`node scripts/seo-baseline.mjs --base=${base.origin} --sample=${sampleLimit}\`\n`);
console.log(`## Summary\n\n- Failures: **${failures.length}**\n- Warnings: **${warnings.length}**\n- Sitemap shards: **${shardUrls.length}**\n- Sitemap URLs: **${entries.length}** (${entries.filter((entry) => /\/en\//.test(new URL(entry.loc).pathname) || new URL(entry.loc).pathname === "/en").length} English, ${entries.filter((entry) => /\/zh\//.test(new URL(entry.loc).pathname) || new URL(entry.loc).pathname === "/zh").length} Chinese)\n- Sampled indexable URLs: **${sampled.length}**${process.argv.includes("--full-sitemap") ? `\n- Full sitemap crawl: **${fullSitemapChecked} URLs, ${fullSitemapProblems} problems**` : ""}\n- Cloudflare edge headers observed: **${cfObserved ? "yes" : "no"}**\n- Challenge/block responses observed: **${challengeObserved ? "yes" : "no"}**\n`);
console.log("## Machine endpoints\n\n| URL | Status | Content-Type | X-Robots-Tag | Cache-Control | ms |\n|---|---:|---|---|---|---:|");
for (const result of [robotsResult, sitemapIndex, ...shardResults]) console.log(`| ${escapeCell(result.url)} | ${result.status || "ERR"} | ${escapeCell(result.type)} | ${escapeCell(result.robotsHeader || "—")} | ${escapeCell(result.cache || "—")} | ${result.ms} |`);
console.log("\n## Sampled pages\n\n| URL | Browser / Googlebot | Canonical | Robots | hreflang | SSR chars | Result |\n|---|---|---|---|---:|---:|---|");
for (const row of sampled) console.log(`| ${escapeCell(row.url)} | ${row.browser.status}/${row.google.status} | ${escapeCell(row.meta.canonical || "—")} | ${escapeCell(row.meta.robots || row.google.robotsHeader || "index (implicit)")} | ${row.meta.alternates.length} | ${row.meta.visibleChars} | ${escapeCell(row.issues.join("; ") || "PASS")} |`);
console.log("\n## Edge cases\n\n| URL | Expected | Status | Canonical | Robots | Result |\n|---|---|---:|---|---|---|");
for (const row of edgeResults) console.log(`| ${escapeCell(row.result.url)} | ${escapeCell(row.expectation)} | ${row.result.status || "ERR"} | ${escapeCell(row.meta.canonical || "—")} | ${escapeCell(row.meta.robots || row.result.robotsHeader || "index (implicit)")} | ${row.pass ? "PASS" : "FAIL"} |`);
console.log("\n## Redirects\n\n| Start | Chain | Result |\n|---|---|---|");
for (const hops of redirects) console.log(`| ${escapeCell(hops[0]?.url)} | ${escapeCell(hops.map((hop) => `${hop.status || "ERR"} ${hop.location ? `→ ${new URL(hop.location, hop.url).pathname}` : new URL(hop.url).pathname}`).join(" · "))} | ${hops.at(-1)?.status === 200 && hops.length <= 2 ? "PASS" : "CHECK"} |`);
console.log(`\n## Failures\n\n${failures.length ? failures.map((item) => `- ${item}`).join("\n") : "- None."}`);
console.log(`\n\n## Warnings / manual verification\n\n${warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- None."}`);
console.log(`\n\n## Sitemap integrity\n\n- Duplicate locs: ${duplicateLocs}\n- Off-origin/invalid locs: ${offOrigin.length}\n- Alternate targets absent from loc set: ${missingAlternates.length}\n- URLs blocked by a listed Disallow prefix: ${blockedSitemapUrls.length}\n- Future lastmod values: ${futureLastmod.length}\n- Research URLs: ${researchCounts.en} English, ${researchCounts.zh} Chinese\n`);

process.exitCode = failures.length ? 1 : 0;
