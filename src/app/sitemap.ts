import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { siteUrl } from "@/lib/site";

export const revalidate = 3600;

const STATIC_ROUTES: Array<[string, MetadataRoute.Sitemap[number]["changeFrequency"], number]> = [
  ["/", "hourly", 1],
  ["/research", "hourly", 0.9],
  ["/institutions", "daily", 0.8],
  ["/consensus", "hourly", 0.8],
  ["/macro", "hourly", 0.8],
  ["/macro/calendar", "daily", 0.6],
  ["/markets", "hourly", 0.6],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [institutions, assets, articles, indicators] = await Promise.all([
    prisma.institution.findMany({ select: { slug: true, lastDiscoveredAt: true } }),
    prisma.asset.findMany({ select: { ticker: true } }),
    prisma.article.findMany({
      where: publicationReadyWhere(),
      orderBy: { publishedAt: "desc" },
      take: 5000,
      select: { id: true, publishedAt: true },
    }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, select: { canonicalKey: true, updatedAt: true } }),
  ]);

  return [
    ...STATIC_ROUTES.map(([path, changeFrequency, priority]) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency,
      priority,
    })),
    ...articles.map((article) => ({
      url: `${base}/research/${article.id}`,
      lastModified: article.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...institutions.map((institution) => ({
      url: `${base}/institution/${institution.slug}`,
      lastModified: institution.lastDiscoveredAt ?? new Date(),
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...assets.map((asset) => ({
      url: `${base}/asset/${asset.ticker}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...indicators.map((indicator) => ({
      url: `${base}/macro/indicator/${indicator.canonicalKey}`,
      lastModified: indicator.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
  ];
}
