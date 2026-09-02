import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchResource } from "./fetch";

// Minimal but spec-faithful robots.txt evaluation (Google-style longest-match).
// Supports User-agent grouping, Allow/Disallow with * and $ wildcards, Crawl-delay.

interface Rule { allow: boolean; pattern: string }
interface Group { agents: string[]; rules: Rule[]; crawlDelay?: number }

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let expectingAgents = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!cur || !expectingAgents) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
        expectingAgents = true;
      }
      cur.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!cur) { cur = { agents: ["*"], rules: [] }; groups.push(cur); }
      expectingAgents = false;
      // An empty Disallow means "allow all" → skip (no restriction).
      if (field === "disallow" && value === "") continue;
      cur.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      if (cur) { expectingAgents = false; const n = parseFloat(value); if (!isNaN(n)) cur.crawlDelay = n; }
    }
    // Sitemap and unknown fields: ignored for permission decisions.
  }
  return groups;
}

/** Select the most specific group matching our UA (longest matching token, else '*'). */
function selectGroup(groups: Group[], ua: string): Group | null {
  const uaLow = ua.toLowerCase();
  let best: Group | null = null;
  let bestLen = -1;
  let star: Group | null = null;
  for (const g of groups) {
    for (const a of g.agents) {
      if (a === "*") { star = star ?? g; continue; }
      if (uaLow.includes(a) && a.length > bestLen) { best = g; bestLen = a.length; }
    }
  }
  return best ?? star;
}

/** Convert a robots path pattern (* and $) to an anchored prefix regex. */
function patternToRegex(pattern: string): RegExp {
  let re = "^";
  for (const ch of pattern) {
    if (ch === "*") re += ".*";
    else if (ch === "$") re += "$";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re);
}

function specificity(pattern: string): number {
  return pattern.replace(/\$$/, "").length;
}

export function robotsAllows(text: string, ua: string, path: string): boolean {
  const group = selectGroup(parseRobots(text), ua);
  if (!group) return true;
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const r of group.rules) {
    if (!patternToRegex(r.pattern).test(path)) continue;
    const s = specificity(r.pattern);
    if (r.allow) bestAllow = Math.max(bestAllow, s);
    else bestDisallow = Math.max(bestDisallow, s);
  }
  if (bestDisallow < 0) return true;      // nothing disallows
  return bestAllow >= bestDisallow;       // Allow wins ties and longer matches
}

export function robotsCrawlDelay(text: string, ua: string): number | undefined {
  return selectGroup(parseRobots(text), ua)?.crawlDelay;
}

export function robotsSitemaps(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => /^sitemap\s*:/i.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim())
    .filter((value) => /^https?:\/\//i.test(value));
}

const robotsCache = new Map<string, string | null>();
const TTL_MS = 24 * 60 * 60 * 1000;
const cacheDir = path.resolve(process.env.ROBOTS_CACHE_ROOT || path.join(process.cwd(), "data", "cache", "robots"));

interface RobotsCacheEntry {
  origin: string;
  fetchedAt: string;
  text: string;
  etag: string | null;
  lastModified: string | null;
}

function cachePath(origin: string) {
  return path.join(cacheDir, createHash("sha256").update(origin).digest("hex") + ".json");
}

async function readCached(origin: string): Promise<RobotsCacheEntry | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(origin), "utf8")) as RobotsCacheEntry;
    return parsed.origin === origin && typeof parsed.text === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCached(entry: RobotsCacheEntry) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(entry.origin), JSON.stringify(entry), "utf8");
}

/** Fetch robots once per process; a disk entry is valid as last-known-good for 24 hours. */
export async function fetchRobots(origin: string): Promise<string | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const cached = await readCached(origin);
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  if (cached && age <= TTL_MS) {
    robotsCache.set(origin, cached.text);
    return cached.text;
  }

  const result = await fetchResource(`${origin}/robots.txt`, 12000, cached ?? undefined);
  if (result.status === 304 && cached) {
    const fresh = { ...cached, fetchedAt: new Date().toISOString() };
    await writeCached(fresh);
    robotsCache.set(origin, fresh.text);
    return fresh.text;
  }
  if (result.ok && result.body && /text|plain|octet-stream/i.test(result.contentType || "text/plain")) {
    const entry: RobotsCacheEntry = {
      origin,
      fetchedAt: new Date().toISOString(),
      text: result.body.toString("utf8"),
      etag: result.etag,
      lastModified: result.lastModified,
    };
    await writeCached(entry);
    robotsCache.set(origin, entry.text);
    return entry.text;
  }
  if (result.status === 404 || result.status === 410) {
    const entry: RobotsCacheEntry = {
      origin,
      fetchedAt: new Date().toISOString(),
      text: "",
      etag: result.etag,
      lastModified: result.lastModified,
    };
    await writeCached(entry);
    robotsCache.set(origin, "");
    return "";
  }

  // A stale entry is deliberately not used: no valid LKG means pause this origin.
  robotsCache.set(origin, null);
  return null;
}
