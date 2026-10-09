#!/usr/bin/env node

import fs from "node:fs/promises";

const base = new URL(process.argv.find((value) => value.startsWith("--base="))?.slice(7) || "http://127.0.0.1:3104");
const canonicalOrigin = new URL(process.argv.find((value) => value.startsWith("--canonical-origin="))?.slice(19) || process.env.SITE_URL || "https://tlines.tech");
const keywords = JSON.parse(await fs.readFile(new URL("../data/seo-keywords.json", import.meta.url), "utf8"));
const targets = [...new Set(keywords.map((row) => row.target_url).filter(Boolean))].sort();
const paths = targets.flatMap((path) => [`/en${path}`, `/zh${path}`]);
const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const decode = (value) => value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? "")]));
const plain = (html) => decode(html.replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const normalizeUrl = (value) => new URL(value, base).toString().replace(/\/$/, "");

function parse(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => attrs(match[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => attrs(match[0]));
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const anchors = [...main.matchAll(/<a\b[^>]*>/gi)].map((match) => attrs(match[0]).href).filter(Boolean);
  return {
    title: decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ""),
    description: metas.find((meta) => meta.name?.toLowerCase() === "description")?.content ?? "",
    robots: metas.find((meta) => meta.name?.toLowerCase() === "robots")?.content ?? "",
    canonical: links.find((link) => link.rel?.toLowerCase().split(/\s+/).includes("canonical"))?.href ?? "",
    alternates: links.filter((link) => link.rel?.toLowerCase().split(/\s+/).includes("alternate") && link.hreflang),
    h1: plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
    mainText: plain(main),
    anchors,
    breadcrumb: /BreadcrumbList|class="breadcrumbs"/.test(html),
    jsonLd: /<script[^>]+application\/ld\+json/i.test(html),
  };
}

const failures = [];
const rows = [];
for (const path of paths) {
  const url = new URL(path, base).toString();
  const expectedCanonical = new URL(path, canonicalOrigin).toString();
  let response;
  let body = "";
  try {
    response = await fetch(url, { redirect: "manual", headers: { "user-agent": googlebot, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
    body = await response.text();
  } catch (error) {
    failures.push(`${path}: request failed (${String(error)})`);
    continue;
  }
  const meta = parse(body);
  const issues = [];
  if (response.status !== 200) issues.push(`status ${response.status}`);
  if (!meta.title) issues.push("missing title");
  if (!meta.description) issues.push("missing description");
  if (!meta.h1) issues.push("missing H1");
  if (!meta.canonical || normalizeUrl(meta.canonical) !== normalizeUrl(expectedCanonical)) issues.push(`canonical mismatch (${meta.canonical || "missing"})`);
  if (/noindex/i.test(`${meta.robots} ${response.headers.get("x-robots-tag") || ""}`)) issues.push("unexpected noindex");
  if (!meta.alternates.some((item) => normalizeUrl(item.href) === normalizeUrl(expectedCanonical))) issues.push("hreflang omits self");
  if (!meta.alternates.some((item) => item.hreflang?.toLowerCase() === "x-default")) issues.push("missing x-default");
  if (!meta.breadcrumb) issues.push("missing breadcrumb");
  if (!meta.jsonLd) issues.push("missing JSON-LD");
  if (meta.mainText.length < 250) issues.push(`thin server HTML (${meta.mainText.length} chars)`);
  const contextual = new Set(meta.anchors.map((href) => new URL(href, url).pathname).filter((href) => href !== path && /^\/(?:en|zh)\/(?:institution|research|markets|topics|economies|macro)(?:\/|$)/.test(href)));
  if (contextual.size < 2) issues.push(`fewer than two contextual internal links (${contextual.size})`);
  if (/\/markets\/crude-oil-wti$/.test(path) && /Brent/i.test(`${meta.title} ${meta.h1}`)) issues.push("WTI page is mislabeled as Brent");
  for (const issue of issues) failures.push(`${path}: ${issue}`);
  rows.push({ path, status: response.status, ...meta, contextualLinks: contextual.size, issues });
}

for (const field of ["title", "canonical"]) {
  const seen = new Map();
  for (const row of rows) {
    const value = row[field];
    if (!value) continue;
    const previous = seen.get(value);
    if (previous) failures.push(`duplicate ${field}: ${previous} and ${row.path}`);
    else seen.set(value, row.path);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  base: base.origin,
  canonicalOrigin: canonicalOrigin.origin,
  keywordTargets: targets.length,
  localizedPagesTested: rows.length,
  passed: rows.filter((row) => row.issues.length === 0).length,
  failed: rows.filter((row) => row.issues.length > 0).length,
  duplicateTitles: failures.filter((failure) => failure.startsWith("duplicate title")).length,
  duplicateCanonicals: failures.filter((failure) => failure.startsWith("duplicate canonical")).length,
  unexpectedNoindex: failures.filter((failure) => failure.includes("unexpected noindex")).length,
  failures,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = failures.length ? 1 : 0;
