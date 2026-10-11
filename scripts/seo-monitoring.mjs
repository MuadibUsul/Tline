#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

export function parseCsv(input) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') { field += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "_"));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])));
}

const number = (value) => {
  const parsed = Number(String(value ?? "").replaceAll(",", "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
/**
 * A count that may genuinely be absent, kept absent.
 *
 * `number("")` is 0, and a GSC figure the operator could not read would then print as a real
 * zero — a reported measurement where there was none. Blank stays blank and renders as "—".
 */
const optionalNumber = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replaceAll(",", "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const languageFor = (row, mapped) => {
  try {
    const path = new URL(row.page).pathname;
    if (path === "/zh" || path.startsWith("/zh/")) return "zh-CN";
    if (path === "/en" || path.startsWith("/en/")) return "en";
  } catch {}
  return mapped?.language ?? (/\p{Script=Han}/u.test(row.query ?? "") ? "zh-CN" : "en");
};
const canonicalPath = (page) => {
  try { return new URL(page).pathname.replace(/^\/(?:en|zh)(?=\/|$)/, "") || "/"; } catch { return ""; }
};
const formatMetric = (bucket) => ({
  clicks: bucket.clicks,
  impressions: bucket.impressions,
  ctr: bucket.impressions ? bucket.clicks / bucket.impressions : 0,
  position: bucket.impressions ? bucket.positionWeight / bucket.impressions : null,
});
const add = (map, key, row) => {
  const current = map.get(key) ?? { clicks: 0, impressions: 0, positionWeight: 0 };
  current.clicks += row.clicks;
  current.impressions += row.impressions;
  current.positionWeight += row.position * row.impressions;
  map.set(key, current);
};
const pct = (value) => `${(value * 100).toFixed(2)}%`;
const cell = (value) => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");

if (process.argv.includes("--self-test")) {
  const rows = parseCsv('date,query,page,clicks,impressions,position\r\n2026-10-01,"gold, forecast",https://tlines.tech/en/markets/gold,2,20,4.5\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].query, "gold, forecast");
  assert.equal(languageFor(rows[0]), "en");
  process.stdout.write("seo-monitoring self-test passed\n");
  process.exit(0);
}

const files = { performance: option("performance"), coverage: option("coverage"), inspection: option("inspection") };
if (!Object.values(files).some(Boolean)) {
  console.error("Usage: npm run seo:monitor -- --performance=performance.csv [--coverage=coverage.csv] [--inspection=inspection.csv]");
  process.exit(2);
}

const read = async (path) => path ? parseCsv(await fs.readFile(path, "utf8")) : [];
const [performance, coverage, inspection, keywords] = await Promise.all([
  read(files.performance), read(files.coverage), read(files.inspection),
  fs.readFile(new URL("../data/seo-keywords.json", import.meta.url), "utf8").then(JSON.parse),
]);
const queryMap = new Map(keywords.map((row) => [row.keyword.toLocaleLowerCase(), row]));
const targetMap = new Map(keywords.filter((row) => row.target_url).map((row) => [row.target_url, row]));
const daily = new Map(), topics = new Map(), entities = new Map();
let unmapped = 0;

for (const raw of performance) {
  const row = {
    date: raw.date || raw.day,
    query: raw.query || raw.queries || "",
    page: raw.page || raw.pages || raw.url || "",
    clicks: number(raw.clicks),
    impressions: number(raw.impressions),
    position: number(raw.position || raw.average_position),
  };
  if (!row.date || (!row.query && !row.page)) continue;
  const mapped = queryMap.get(row.query.toLocaleLowerCase()) ?? targetMap.get(canonicalPath(row.page));
  const language = languageFor(row, mapped);
  add(daily, `${row.date}|${language}`, row);
  add(topics, `${language}|${mapped?.topic ?? "unmapped"}`, row);
  add(entities, `${language}|${mapped?.entity ?? "unmapped"}`, row);
  if (!mapped) unmapped++;
}

console.log(`# Tlines SEO monitoring snapshot\n\nGenerated: ${new Date().toISOString()}\n`);
console.log(`## Input completeness\n\n- Performance rows: ${performance.length}\n- Coverage rows: ${coverage.length}\n- URL inspection rows: ${inspection.length}\n- Unmapped performance rows: ${unmapped}\n`);
console.log("## Daily search performance\n\n| Date | Language | Clicks | Impressions | CTR | Avg position |\n|---|---|---:|---:|---:|---:|");
for (const [key, bucket] of [...daily.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const [date, language] = key.split("|");
  const metric = formatMetric(bucket);
  console.log(`| ${date} | ${language} | ${metric.clicks} | ${metric.impressions} | ${pct(metric.ctr)} | ${metric.position?.toFixed(2) ?? "—"} |`);
}

for (const [heading, data] of [["Topic performance", topics], ["Entity performance", entities]]) {
  console.log(`\n## ${heading}\n\n| Language | Group | Clicks | Impressions | CTR | Avg position |\n|---|---|---:|---:|---:|---:|`);
  for (const [key, bucket] of [...data.entries()].sort((left, right) => right[1].impressions - left[1].impressions)) {
    const [language, group] = key.split("|");
    const metric = formatMetric(bucket);
    console.log(`| ${language} | ${cell(group)} | ${metric.clicks} | ${metric.impressions} | ${pct(metric.ctr)} | ${metric.position?.toFixed(2) ?? "—"} |`);
  }
}

if (coverage.length) {
  console.log("\n## Page indexing coverage\n\n| Snapshot | Language | Status | Count |\n|---|---|---|---:|");
  for (const row of coverage) console.log(`| ${cell(row.snapshot_date || row.date)} | ${cell(row.language)} | ${cell(row.status)} | ${cell(optionalNumber(row.count))} |`);
}
if (inspection.length) {
  console.log("\n## URL inspection samples\n\n| Snapshot | URL | Language | Index status | Last crawl | HTTP |\n|---|---|---|---|---|---:|");
  for (const row of inspection) console.log(`| ${cell(row.snapshot_date || row.date)} | ${cell(row.url)} | ${cell(row.language || languageFor({ page: row.url }))} | ${cell(row.index_status || row.status)} | ${cell(row.last_crawl)} | ${cell(optionalNumber(row.http_status))} |`);
}
