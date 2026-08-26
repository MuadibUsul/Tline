import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { fetchResource } from "./fetch";

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
  const candidates = new Map<string, SitemapCandidate>();

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
      if (!allowedArticleUrl(candidate.url, source)) continue;
      if (candidate.lastModified && candidate.lastModified < since) continue;
      const clean = candidate.url.split("#")[0];
      const existing = candidates.get(clean);
      if (!existing || (candidate.lastModified?.getTime() ?? 0) > (existing.lastModified?.getTime() ?? 0)) {
        candidates.set(clean, { ...candidate, url: clean });
      }
    }
  }

  return [...candidates.values()]
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .slice(0, limit);
}
