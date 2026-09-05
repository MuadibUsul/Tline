import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";
import { LOCALES, localePath } from "@/lib/i18n";
import { contentQuality } from "@/lib/contentQuality";

// Rendered per request like every other route: the production image is built without a
// database, so prerendering this at build time cannot reach Prisma.
export const dynamic = "force-dynamic";

const STATIC_ROUTES: Array<[string, MetadataRoute.Sitemap[number]["changeFrequency"], number]> = [
  ["/", "hourly", 1],
  ["/research", "hourly", 0.9],
  ["/institutions", "daily", 0.8],
  ["/consensus", "hourly", 0.8],
  ["/macro", "hourly", 0.8],
  ["/macro/calendar", "daily", 0.6],
  ["/markets", "hourly", 0.6],
  ["/about", "monthly", 0.5],
  ["/methodology", "monthly", 0.6],
  ["/editorial-policy", "monthly", 0.5],
  ["/ai-usage", "monthly", 0.5],
  ["/sources", "weekly", 0.6],
  ["/corrections", "monthly", 0.5],
];

const STATIC_UPDATED_AT = new Date("2026-09-05T00:00:00.000Z");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [institutions, assets, articles, indicators, consensusUpdates] = await Promise.all([
    prisma.institution.findMany({ select: { slug: true, lastDiscoveredAt: true } }),
    prisma.asset.findMany({ select: { id: true, ticker: true } }),
    prisma.article.findMany({
      where: publicationReadyWhere(),
      orderBy: { publishedAt: "desc" },
      take: 5000,
      select: {
        id: true, title: true, rawText: true, sourceUrl: true, language: true, publishedAt: true, createdAt: true,
        analysis: { select: { summary: true, summaryZh: true, reviewStatus: true } },
        translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true, qualityScore: true, status: true, updatedAt: true } },
      },
    }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, select: { canonicalKey: true, updatedAt: true } }),
    prisma.consensusHistory.findMany({ orderBy: { timestamp: "desc" }, distinct: ["assetId"], select: { assetId: true, timestamp: true } }),
  ]);
  const consensusUpdatedAt = new Map(consensusUpdates.map((row) => [row.assetId, row.timestamp]));

  /**
   * Every page in both languages.
   *
   * Each language has its own address now, so listing only one would leave the other
   * undiscoverable — which is the whole reason the addresses were split.
   */
  const pages: MetadataRoute.Sitemap = [
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
    // The consensus view of each asset, and each institution's settled record: pages that
    // exist nowhere else and were absent from the map entirely.
    ...assets.map((asset) => ({
      url: `${base}/consensus/${asset.ticker}`,
      lastModified: consensusUpdatedAt.get(asset.id) ?? STATIC_UPDATED_AT,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...institutions.map((institution) => ({
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

  const localizedPages = pages.flatMap((page) => {
    const path = page.url.startsWith(base) ? page.url.slice(base.length) || "/" : page.url;
    return LOCALES.map((locale) => ({ ...page, url: base + localePath(locale, path) }));
  });
  const researchPages = articles.flatMap((article) => LOCALES.flatMap((locale) => {
    if (!contentQuality(article, locale).indexable) return [];
    return [{
      url: base + localePath(locale, `/research/${article.id}`),
      lastModified: locale === "zh-CN" ? article.translations[0]?.updatedAt ?? article.createdAt : article.createdAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }];
  }));
  return [...localizedPages, ...researchPages];
}
