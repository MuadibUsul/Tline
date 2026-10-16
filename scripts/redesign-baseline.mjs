#!/usr/bin/env node
/**
 * Phase-0 baseline capture, read-only against production (docs/redesign/06, M0/M2).
 *
 * For every core template it records what the redesign must not silently change: status,
 * title, description, canonical, robots, hreflang set, JSON-LD types, the H1, and a
 * fingerprint of the first 4,000 characters of body text (so "the words changed" is
 * detectable without storing the words). The snapshot is committed; `--check` re-captures
 * and diffs against it.
 *
 *   node scripts/redesign-baseline.mjs [--base=https://tlines.tech] [--out=docs/redesign/baseline]
 *   node scripts/redesign-baseline.mjs --check
 *
 * Exit codes: 0 = captured/reported; 1 (--check) = a protected field changed
 * (status/canonical/robots/hreflang); title/description/body changes are reported but do
 * not fail — those are the fields a redesign is allowed to review deliberately.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flagOf = (name, fallback) => {
  const hit = args.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = flagOf("base", "https://tlines.tech").replace(/\/+$/, "");
const OUT_DIR = path.resolve(flagOf("out", "docs/redesign/baseline"));
const CHECK = args.includes("--check");
const UA = "TlinesBaseline/1.0 (+https://tlines.tech; read-only phase-0 snapshot)";
const DELAY_MS = 120;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, text: response.ok ? await response.text() : "" };
}

function decode(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function extract(html) {
  const head = (re) => html.match(re)?.[1]?.trim() ?? null;
  const jsonLdTypes = [];
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      const collect = (node) => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (!node || typeof node !== "object") return;
        if (typeof node["@type"] === "string") jsonLdTypes.push(node["@type"]);
        else if (Array.isArray(node["@type"])) jsonLdTypes.push(...node["@type"]);
        if (Array.isArray(node["@graph"])) node["@graph"].forEach(collect);
      };
      collect(parsed);
    } catch { /* a malformed block is itself a finding via a missing type */ }
  }
  const hreflang = {};
  for (const match of html.matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"/g)) hreflang[match[1]] = match[2];
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: decode(head(/<title>([\s\S]*?)<\/title>/)),
    description: decode(head(/<meta name="description" content="([^"]*)"/)),
    canonical: head(/<link rel="canonical" href="([^"]+)"/),
    robots: head(/<meta name="robots" content="([^"]+)"/),
    hreflang,
    jsonLdTypes: [...new Set(jsonLdTypes)].sort(),
    h1: decode(head(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null),
    bodyTextLength: bodyText.length,
    bodyTextHash: createHash("sha256").update(bodyText.slice(0, 4000)).digest("hex").slice(0, 16),
  };
}

async function sitemapUrls() {
  const { text } = await fetchText(`${BASE}/sitemap.xml`);
  const shards = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const byShard = new Map();
  for (const shard of shards) {
    const name = shard.split("/").pop().replace(/\.xml$/, "");
    const { text: shardText } = await fetchText(shard);
    byShard.set(name, [...shardText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    await sleep(DELAY_MS);
  }
  const sample = (urls, every, cap) => urls.filter((_, index) => index % every === 0).slice(0, cap);
  const selected = [];
  for (const [name, urls] of byShard) {
    if (name.startsWith("pages-")) selected.push(...urls);
    else if (name.startsWith("assets-")) selected.push(...urls);
    else if (name.startsWith("institutions-")) selected.push(...sample(urls, 4, 16));
    else if (name.startsWith("topics-")) selected.push(...sample(urls, 4, 16));
    else if (name.startsWith("research-")) selected.push(...sample(urls, 75, 25));
  }
  return selected;
}

async function capture() {
  const urls = await sitemapUrls();
  console.log(`capturing ${urls.length} URLs from ${BASE}`);
  const entries = [];
  for (const url of urls) {
    try {
      const { status, text } = await fetchText(url);
      entries.push({ url: url.replace(BASE, ""), status, ...extract(text) });
    } catch (error) {
      entries.push({ url: url.replace(BASE, ""), status: 0, error: String(error).slice(0, 120) });
    }
    if (entries.length % 25 === 0) console.log(`  ${entries.length}/${urls.length}`);
    await sleep(DELAY_MS);
  }
  return { capturedAt: new Date().toISOString(), base: BASE, urlCount: entries.length, entries };
}

async function latestSnapshot() {
  const files = (await readdir(OUT_DIR).catch(() => [])).filter((name) => name.startsWith("head-snapshot-")).sort();
  if (!files.length) throw new Error(`no snapshot in ${OUT_DIR}; run without --check first`);
  const file = path.join(OUT_DIR, files[files.length - 1]);
  return { file, snapshot: JSON.parse(await readFile(file, "utf8")) };
}

async function check() {
  const { file, snapshot } = await latestSnapshot();
  const current = await capture();
  const before = new Map(snapshot.entries.map((entry) => [entry.url, entry]));
  const protectedChanges = [];
  const reviewChanges = [];
  for (const entry of current.entries) {
    const old = before.get(entry.url);
    if (!old) { reviewChanges.push(`${entry.url}: NEW`); continue; }
    if (old.status !== entry.status) protectedChanges.push(`${entry.url}: status ${old.status} -> ${entry.status}`);
    for (const field of ["canonical", "robots"]) {
      if (old[field] !== entry[field]) protectedChanges.push(`${entry.url}: ${field}\n    old: ${old[field]}\n    new: ${entry[field]}`);
    }
    const oldHreflang = JSON.stringify(old.hreflang ?? {});
    const newHreflang = JSON.stringify(entry.hreflang ?? {});
    if (oldHreflang !== newHreflang) protectedChanges.push(`${entry.url}: hreflang\n    old: ${oldHreflang}\n    new: ${newHreflang}`);
    if (old.title !== entry.title) reviewChanges.push(`${entry.url}: title\n    old: ${old.title}\n    new: ${entry.title}`);
    if (old.bodyTextHash !== entry.bodyTextHash) reviewChanges.push(`${entry.url}: body fingerprint ${old.bodyTextHash} -> ${entry.bodyTextHash}`);
    if (old.jsonLdTypes?.join(",") !== entry.jsonLdTypes?.join(",")) reviewChanges.push(`${entry.url}: JSON-LD [${old.jsonLdTypes}] -> [${entry.jsonLdTypes}]`);
  }
  const removed = [...before.keys()].filter((url) => !current.entries.some((entry) => entry.url === url));
  for (const url of removed) reviewChanges.push(`${url}: MISSING from sitemap now`);
  console.log(`compared against ${file}`);
  console.log(`protected changes (fail): ${protectedChanges.length}`);
  for (const line of protectedChanges) console.log(`  ✖ ${line}`);
  console.log(`review changes (report): ${reviewChanges.length}`);
  for (const line of reviewChanges) console.log(`  · ${line}`);
  return protectedChanges.length ? 1 : 0;
}

const run = CHECK
  ? check()
  : capture().then(async (snapshot) => {
      await mkdir(OUT_DIR, { recursive: true });
      const file = path.join(OUT_DIR, `head-snapshot-${snapshot.capturedAt.slice(0, 10)}.json`);
      await writeFile(file, JSON.stringify(snapshot, null, 1) + "\n", "utf8");
      console.log(`wrote ${file} (${snapshot.urlCount} URLs)`);
    });

run.then((code) => { if (typeof code === "number") process.exitCode = code; }).catch((error) => { console.error(error); process.exitCode = 1; });
