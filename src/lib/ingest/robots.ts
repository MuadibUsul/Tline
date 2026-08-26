import { fetchText } from "./fetch";

// Minimal but spec-faithful robots.txt evaluation (Google-style longest-match).
// Supports User-agent grouping, Allow/Disallow with * and $ wildcards, Crawl-delay.

interface Rule { allow: boolean; pattern: string }
interface Group { agents: string[]; rules: Rule[]; crawlDelay?: number }

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let expectingAgents = false;

  for (let raw of text.split(/\r?\n/)) {
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

const robotsCache = new Map<string, string | null>();

/** Fetch (and cache) robots.txt for an origin. null = fetch failed/unreachable. */
export async function fetchRobots(origin: string): Promise<string | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const txt = await fetchText(`${origin}/robots.txt`, 12000);
  robotsCache.set(origin, txt);
  return txt;
}
