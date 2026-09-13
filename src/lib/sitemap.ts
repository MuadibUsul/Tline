import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";
import { LOCALES, localePath } from "@/lib/i18n";
import { researchPath } from "@/lib/researchPath";

export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

/**
 * Articles per research shard. Each article contributes up to one URL per locale, so this
 * leaves a wide margin under the 50,000 URL / 50MB ceiling a single sitemap file may hold.
 */
export const SHARD_SIZE = Math.max(100, Number(process.env.SITEMAP_SHARD_SIZE || 2000));

/**
 * Articles read from the database at a time while a shard is assembled.
 *
 * Reading in chunks keeps peak memory flat no matter how large the corpus grows.
 */
const SCAN_CHUNK = 250;

const ARTICLE_ORDER = [{ publishedAt: "asc" as const }, { id: "asc" as const }];

/**
 * Oldest first, so an article keeps the shard it was born in.
 *
 * Newest-first would renumber every shard each time an article arrived, and a crawler
 * would have to refetch all of them to discover that nothing but the newest had changed.
 */
const ARTICLE_SELECT = {
  id: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
  translations: {
    where: { locale: "zh-CN" },
    take: 1,
    select: { updatedAt: true },
  },
} as const;

const STATIC_ROUTES: Array<[string, SitemapEntry["changeFrequency"], number]> = [
  ["/", "hourly", 1],
  ["/research", "hourly", 0.9],
  ["/institutions", "daily", 0.8],
  ["/macro", "hourly", 0.8],
  ["/macro/calendar", "daily", 0.6],
  ["/watchlist", "hourly", 0.8],
  ["/about", "monthly", 0.5],
  ["/methodology", "monthly", 0.6],
  ["/editorial-policy", "monthly", 0.5],
  ["/ai-usage", "monthly", 0.5],
  ["/sources", "weekly", 0.6],
  ["/privacy", "monthly", 0.5],
  ["/corrections", "monthly", 0.5],
];

const STATIC_UPDATED_AT = new Date("2026-09-05T00:00:00.000Z");

export async function researchArticleCount(): Promise<number> {
  return prisma.article.count({ where: publicationReadyWhere() });
}

/** Shard 0 carries the site's own pages; 1..N carry research. Always at least one of each. */
export async function researchShardCount(): Promise<number> {
  return Math.max(1, Math.ceil((await researchArticleCount()) / SHARD_SIZE));
}

/** Every page that is not an article, in both languages. */
export async function buildPagesShard(): Promise<SitemapEntry[]> {
  const base = siteUrl();
  const [institutions, assets, indicators, consensusUpdates, settledInstitutions] = await Promise.all([
    prisma.institution.findMany({ select: { id: true, slug: true, lastDiscoveredAt: true } }),
    prisma.asset.findMany({ select: { id: true, ticker: true } }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, select: { canonicalKey: true, updatedAt: true } }),
    prisma.consensusHistory.findMany({ orderBy: { timestamp: "desc" }, distinct: ["assetId"], select: { assetId: true, timestamp: true } }),
    prisma.forecast.findMany({ where: { status: "settled" }, distinct: ["institutionId"], select: { institutionId: true } }),
  ]);
  const consensusUpdatedAt = new Map(consensusUpdates.map((row) => [row.assetId, row.timestamp]));
  // An accuracy page with nothing settled is the same sentence on every institution's page.
  // Offering fifty of those is how a map spends its crawl budget on pages that will be read
  // once and never indexed; they stay reachable, just not advertised.
  const hasSettledForecasts = new Set(settledInstitutions.map((row) => row.institutionId));

  const pages: SitemapEntry[] = [
    ...STATIC_ROUTES.map(([path, changeFrequency, priority]) => ({
      url: `${base}${path}`,
      lastModified: STATIC_UPDATED_AT,
      changeFrequency,
      priority,
    })),
    ...institutions.map((institution) => ({
      url: `${base}/institution/${institution.slug}`,
      lastModified: institution.lastDiscoveredAt ?? STATIC_UPDATED_AT,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...assets.map((asset) => ({
      url: `${base}/asset/${asset.ticker}`,
      lastModified: consensusUpdatedAt.get(asset.id) ?? STATIC_UPDATED_AT,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...institutions.filter((institution) => hasSettledForecasts.has(institution.id)).map((institution) => ({
      url: `${base}/institution/${institution.slug}/accuracy`,
      lastModified: institution.lastDiscoveredAt ?? STATIC_UPDATED_AT,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...indicators.map((indicator) => ({
      url: `${base}/macro/indicator/${indicator.canonicalKey}`,
      lastModified: indicator.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];

  /**
   * Each language has its own address, so listing only one would leave the other
   * undiscoverable — which is the whole reason the addresses were split.
   */
  return pages.flatMap((page) => {
    const path = page.url.startsWith(base) ? page.url.slice(base.length) || "/" : page.url;
    return LOCALES.map((locale) => ({ ...page, url: base + localePath(locale, path) }));
  });
}

/** Research shard `index`, counting from 1. Out-of-range shards are empty, not an error. */
export async function buildResearchShard(index: number): Promise<SitemapEntry[]> {
  const base = siteUrl();
  const where = publicationReadyWhere();
  const start = (index - 1) * SHARD_SIZE;
  const entries: SitemapEntry[] = [];

  for (let offset = 0; offset < SHARD_SIZE; offset += SCAN_CHUNK) {
    const articles = await prisma.article.findMany({
      where,
      orderBy: ARTICLE_ORDER,
      skip: start + offset,
      take: Math.min(SCAN_CHUNK, SHARD_SIZE - offset),
      select: ARTICLE_SELECT,
    });
    for (const article of articles) {
      for (const locale of LOCALES) {
        entries.push({
          url: base + localePath(locale, researchPath(article)),
          lastModified: locale === "zh-CN" ? article.translations[0]?.updatedAt ?? article.updatedAt : article.updatedAt,
          changeFrequency: "monthly",
          priority: 0.7,
        });
      }
    }
    if (articles.length < SCAN_CHUNK) break;
  }
  return entries;
}

/**
 * When each shard last changed, for the index.
 *
 * Reads the same articles in the same order as the shards do, but only the two timestamps
 * that decide `lastmod` — no bodies, no translations text.
 */
export async function researchShardLastModified(): Promise<Date[]> {
  const rows = await prisma.article.findMany({
    where: publicationReadyWhere(),
    orderBy: ARTICLE_ORDER,
    select: { updatedAt: true, translations: { where: { locale: "zh-CN" }, take: 1, select: { updatedAt: true } } },
  });
  const shards: Date[] = [];
  rows.forEach((row, position) => {
    const shard = Math.floor(position / SHARD_SIZE);
    const changed = row.translations[0]?.updatedAt ?? row.updatedAt;
    if (!shards[shard] || changed > shards[shard]) shards[shard] = changed;
  });
  return shards;
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);
}

export function renderUrlset(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => [
    "  <url>",
    `    <loc>${escapeXml(entry.url)}</loc>`,
    `    <lastmod>${entry.lastModified.toISOString()}</lastmod>`,
    entry.changeFrequency ? `    <changefreq>${entry.changeFrequency}</changefreq>` : null,
    entry.priority === undefined ? null : `    <priority>${entry.priority}</priority>`,
    "  </url>",
  ].filter((line) => line !== null).join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderSitemapIndex(shards: Array<{ url: string; lastModified: Date }>): string {
  const items = shards.map((shard) => [
    "  <sitemap>",
    `    <loc>${escapeXml(shard.url)}</loc>`,
    `    <lastmod>${shard.lastModified.toISOString()}</lastmod>`,
    "  </sitemap>",
  ].join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

/** One hour at the edge, a day of stale service if the origin is busy or down. */
export const SITEMAP_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
