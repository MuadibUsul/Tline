import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { fetchResource } from "./fetch";
import { inferPublicationDate } from "./extract";

export interface SitemapCandidate {
  url: string;
  lastModified: Date | null;
}

export interface ParsedSitemap {
  indexes: string[];
  urls: SitemapCandidate[];
}

export function parseSitemap(xml: string): ParsedSitemap {
  const $ = cheerio.load(xml, { xmlMode: true });
  const indexes = $("sitemap > loc").toArray().map((node) => $(node).text().trim()).filter(Boolean);
  const urls = $("url").toArray().flatMap((node) => {
    const url = $(node).find("loc").first().text().trim();
    if (!url) return [];
    const rawDate = $(node).find("lastmod").first().text().trim();
    const parsed = rawDate ? new Date(rawDate) : null;
    return [{ url, lastModified: parsed && !isNaN(parsed.getTime()) ? parsed : null }];
  });
  return { indexes, urls };
}

function allowedArticleUrl(raw: string, source: URL) {
  try {
    const candidate = new URL(raw);
    if (!["http:", "https:"].includes(candidate.protocol)) return false;
    if (candidate.hostname !== source.hostname) return false;
    if (/\.(?:jpe?g|png|gif|svg|webp|zip|xlsx?|docx?|pptx?|mp[34])$/i.test(candidate.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

const RESEARCH_PATH = /(?:^|\/)(?:insights?|research|outlooks?|markets?|econom(?:y|ics?)|strateg(?:y|ies|ic)|investment|views?|reports?|publications?|analysis|thought-leadership)(?:\/|[-_.]|$)/i;
const NON_RESEARCH_PATH = /(?:^|\/)(?:about|careers?|contact|events?|help|legal|newsroom|privacy|products?|services?|solutions?|governance|investors?|shareholders?|policies?|annual-reports?)(?:\/|[-_.]|$)/i;
const COMMON_SOURCE_PARTS = new Set([
  "about", "global", "en", "us", "uk", "www", "index", "home", "html", "htm",
  "page",
  "insight", "insights", "research", "report", "reports", "publication", "publications", "market", "markets", "news",
]);

/** Rank sitemap URLs against the configured research section; non-positive means reject. */
export function sitemapArticleRelevance(raw: string, sourceUrl: string): number {
  try {
    const candidate = new URL(raw);
    const source = new URL(sourceUrl);
    if (!allowedArticleUrl(raw, source)) return 0;

    const path = decodeURIComponent(candidate.pathname).toLowerCase().replace(/\/$/, "");
    const sourcePath = decodeURIComponent(source.pathname).toLowerCase().replace(/\/$/, "");
    if (!path || path === sourcePath) return 0;
    if (NON_RESEARCH_PATH.test(path)) return 0;

    const sourceDirectory = sourcePath.replace(/\/[^/]*\.[a-z0-9]+$/i, "");
    const underSection = sourceDirectory.length > 1 && path.startsWith(`${sourceDirectory}/`);
    const sourceParts = sourcePath.split(/[^a-z0-9]+/).filter((part) => part.length > 3 && !COMMON_SOURCE_PARTS.has(part));
    const candidateParts = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
    const sharedParts = sourceParts.filter((part) => candidateParts.has(part)).length;
    const researchPath = RESEARCH_PATH.test(path);

    const slug = path.split("/").filter(Boolean).pop() ?? "";
    const articleShaped = /\.pdf$/i.test(path)
      || /\/20\d\d(?:\/|-)/.test(path)
      || (slug.length >= 16 && (slug.match(/-/g) || []).length >= 2)
      || (underSection && path.split("/").length > sourceDirectory.split("/").length);
    if ((!underSection && sharedParts === 0) || !articleShaped) return 0;

    return (underSection ? 4 : 0) + (researchPath ? 2 : 0) + Math.min(sharedParts, 2) + (/\.pdf$/i.test(path) ? 1 : 0);
  } catch {
    return 0;
  }
}

/** Prefer a publication date encoded in the URL; sitemap lastmod is only an edit timestamp. */
export function sitemapDateHint(raw: string, lastModified: Date | null): Date | null {
  const exact = inferPublicationDate(raw);
  if (exact) return exact;
  let path = raw;
  try { path = decodeURIComponent(new URL(raw).pathname); } catch { /* use raw value */ }
  const month = path.match(/(?:^|\/)(20\d{2})\/(0?[1-9]|1[0-2])(?:\/|$)/);
  return month ? new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)) : lastModified;
}

async function fetchSitemap(url: string) {
  const result = await fetchResource(url, 20000);
  if (!result.ok || !result.body) return null;
  try {
    const body = /gzip/i.test(result.contentType) || url.toLowerCase().endsWith(".gz")
      ? gunzipSync(result.body)
      : result.body;
    return body.toString("utf8");
  } catch {
    return null;
  }
}

export async function discoverFromSitemaps(
  seeds: string[],
  sourceUrl: string,
  options: { since?: Date; limit?: number; maxSitemaps?: number; allows?: (url: string) => boolean } = {},
) {
  const source = new URL(sourceUrl);
  const since = options.since ?? new Date(Date.now() - 180 * 864e5);
  const limit = options.limit ?? 20;
  const maxSitemaps = options.maxSitemaps ?? 20;
  const queue = [...new Set(seeds)].filter((seed) => {
    try {
      const url = new URL(seed);
      return ["http:", "https:"].includes(url.protocol) && url.hostname === source.hostname && (options.allows?.(seed) ?? true);
    } catch {
      return false;
    }
  });
  const visited = new Set<string>();
  const candidates = new Map<string, SitemapCandidate & { relevance: number; sortDate: number }>();

  while (queue.length && visited.size < maxSitemaps) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const xml = await fetchSitemap(sitemapUrl);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    for (const index of parsed.indexes) {
      if (!visited.has(index) && (options.allows?.(index) ?? true) && queue.length + visited.size < maxSitemaps) queue.push(index);
    }
    for (const candidate of parsed.urls) {
      const relevance = sitemapArticleRelevance(candidate.url, sourceUrl);
      if (relevance <= 0) continue;
      const dateHint = sitemapDateHint(candidate.url, candidate.lastModified);
      if (dateHint && dateHint < since) continue;
      const clean = candidate.url.split("#")[0];
      const existing = candidates.get(clean);
      if (!existing || (candidate.lastModified?.getTime() ?? 0) > (existing.lastModified?.getTime() ?? 0)) {
        candidates.set(clean, { ...candidate, url: clean, relevance, sortDate: dateHint?.getTime() ?? 0 });
      }
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.relevance - a.relevance || b.sortDate - a.sortDate)
    .slice(0, limit)
    .map(({ relevance: _, sortDate: __, ...candidate }) => candidate);
}
