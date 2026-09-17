import { cache } from "react";
import { prisma } from "./db";
import { publicationReadyWhere } from "./publication";
import { listIndexableTopics, topicKey, topicLabel, topicPath } from "./topics";
import type { Locale } from "./i18n";

/**
 * Contextual links, read from the relations the ingestion already stored.
 *
 * Every edge here comes from a row that exists: an atomic view naming a ticker, an
 * article-asset row, a macro forecast attached to both an article and an indicator. Nothing
 * is inferred from keyword overlap, and nothing is emitted when the row is absent — a page
 * with no topic gets no topic link rather than a guess.
 */

const GENERIC_KEY = /^(?:general|market|other|unspecified|macro|macroeconomics|economics)$/;


/**
 * Only topics that are actually pages.
 *
 * A topic is a hub when the whole corpus clears the threshold, which one report's own topic
 * list cannot know. Linking to a subject that has no page sends a reader — and a crawler —
 * to a 404, so the relation is dropped rather than rendered.
 */
async function withPages(topics: RelatedTopic[]): Promise<RelatedTopic[]> {
  if (!topics.length) return topics;
  const published = new Set((await listIndexableTopics()).map((topic) => topic.key));
  return topics.filter((topic) => published.has(topic.key));
}

export interface RelatedTopic { key: string; label: string; views: number }
export interface RelatedAsset { ticker: string; name: string }
export interface RelatedIndicator { canonicalKey: string; name: string }
export interface PeerReport {
  slug: string; title: string; publishedAt: Date;
  institution: { name: string; slug: string };
}

/**
 * Topics for one report, from its own views, ordered by how often the report returns to
 * them. Topics that normalise to nothing are dropped rather than linked to a generic hub.
 */
export const getArticleTopics = cache(async (articleId: string, locale: Locale, take = 4): Promise<RelatedTopic[]> => {
  const rows = await prisma.atomicView.findMany({
    where: { articleId, reviewStatus: "ok" },
    select: { topic: true },
  });
  const counts = new Map<string, { raw: string; views: number }>();
  for (const row of rows) {
    const raw = row.topic?.trim();
    if (!raw) continue;
    const key = topicKey(raw);
    if (!key || GENERIC_KEY.test(key)) continue;
    const entry = counts.get(key) ?? { raw, views: 0 };
    entry.views += 1;
    counts.set(key, entry);
  }
  return withPages([...counts.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, take)
    .map(([key, entry]) => ({ key, label: topicLabel(entry.raw, locale), views: entry.views })));
});

/**
 * Other institutions' reports on the same assets.
 *
 * Same-asset reports from the same publisher are excluded: the value of the block is seeing
 * where a second house stands, and a publisher's own follow-up note is not that.
 */
export const getPeerReports = cache(async (input: { articleId: string; ticker: string; institutionId: string; take?: number }): Promise<PeerReport[]> => {
  const take = input.take ?? 3;
  const asset = await prisma.asset.findUnique({ where: { ticker: input.ticker }, select: { id: true } });
  if (!asset) return [];
  const rows = await prisma.article.findMany({
    where: publicationReadyWhere({
      id: { not: input.articleId },
      institutionId: { not: input.institutionId },
      articleAssets: { some: { assetId: asset.id } },
    }),
    orderBy: { publishedAt: "desc" },
    take,
    select: { slug: true, title: true, publishedAt: true, institution: { select: { name: true, slug: true } } },
  });
  return rows;
});

/** Tickers a report touches, from its extracted asset views. */
export const getArticleAssets = cache(async (articleId: string): Promise<RelatedAsset[]> => {
  const rows = await prisma.atomicView.findMany({
    where: { articleId, reviewStatus: "ok", assetTicker: { not: null } },
    select: { assetTicker: true, asset: true },
  });
  const seen = new Map<string, string>();
  for (const row of rows) if (row.assetTicker && !seen.has(row.assetTicker)) seen.set(row.assetTicker, row.asset);
  return [...seen.entries()].map(([ticker, name]) => ({ ticker, name }));
});

/**
 * Economic indicators that this asset's coverage actually mentions.
 *
 * The edge is a macro forecast mined from a report that also names the asset, so the link
 * exists in the data rather than in a hand-written list of plausible pairings.
 */
export const getAssetIndicators = cache(async (ticker: string, locale: Locale, take = 4): Promise<RelatedIndicator[]> => {
  const asset = await prisma.asset.findUnique({ where: { ticker }, select: { id: true } });
  if (!asset) return [];
  const forecasts = await prisma.macroForecast.findMany({
    where: { article: { articleAssets: { some: { assetId: asset.id } } } },
    select: { indicatorKey: true },
    take: 200,
  });
  const keys = [...new Set(forecasts.map((row) => row.indicatorKey))].slice(0, 12);
  if (!keys.length) return [];
  const indicators = await prisma.macroIndicator.findMany({
    where: { canonicalKey: { in: keys }, enabled: true },
    select: { canonicalKey: true, nameEn: true, nameZh: true },
  });
  return indicators
    .map((indicator) => ({ canonicalKey: indicator.canonicalKey, name: locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn }))
    .slice(0, take);
});

/** Assets an institution's research covers most, from its published reports. */
export const getInstitutionAssets = cache(async (slug: string, take = 8): Promise<RelatedAsset[]> => {
  const rows = await prisma.articleAsset.findMany({
    where: { article: publicationReadyWhere({ institution: { slug } }) },
    select: { asset: { select: { ticker: true, name: true } } },
    take: 400,
  });
  const counts = new Map<string, { name: string; n: number }>();
  for (const row of rows) {
    const entry = counts.get(row.asset.ticker) ?? { name: row.asset.name, n: 0 };
    entry.n += 1;
    counts.set(row.asset.ticker, entry);
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, take).map(([ticker, entry]) => ({ ticker, name: entry.name }));
});

/** Topics an institution writes about most, from its extracted views. */
export const getInstitutionTopics = cache(async (slug: string, locale: Locale, take = 8): Promise<RelatedTopic[]> => {
  const rows = await prisma.atomicView.findMany({
    where: { reviewStatus: "ok", article: publicationReadyWhere({ institution: { slug } }) },
    select: { topic: true },
    take: 600,
  });
  const counts = new Map<string, { raw: string; views: number }>();
  for (const row of rows) {
    const raw = row.topic?.trim();
    if (!raw) continue;
    const key = topicKey(raw);
    if (!key || GENERIC_KEY.test(key)) continue;
    const entry = counts.get(key) ?? { raw, views: 0 };
    entry.views += 1;
    counts.set(key, entry);
  }
  return withPages([...counts.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, take)
    .map(([key, entry]) => ({ key, label: topicLabel(entry.raw, locale), views: entry.views })));
});

/** Assets that the same topic keeps coming back to. */
export const getTopicAssets = cache(async (key: string, tickers: string[], locale: Locale, take = 10): Promise<RelatedAsset[]> => {
  if (!tickers.length) return [];
  const assets = await prisma.asset.findMany({ where: { ticker: { in: tickers.slice(0, take) } }, select: { ticker: true, name: true } });
  const order = new Map(tickers.map((ticker, index) => [ticker, index]));
  return assets.sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));
});

/**
 * Topics that the reports covering one asset keep raising.
 *
 * The edge runs asset → article-asset row → that article's views → topic, so a topic appears
 * here only because a report that names the asset actually mentioned it.
 */
export const getAssetTopics = cache(async (ticker: string, locale: Locale, take = 6): Promise<RelatedTopic[]> => {
  const asset = await prisma.asset.findUnique({ where: { ticker }, select: { id: true } });
  if (!asset) return [];
  const rows = await prisma.atomicView.findMany({
    where: { reviewStatus: "ok", article: { articleAssets: { some: { assetId: asset.id } } } },
    select: { topic: true },
    take: 800,
  });
  const counts = new Map<string, { raw: string; views: number }>();
  for (const row of rows) {
    const raw = row.topic?.trim();
    if (!raw) continue;
    const key = topicKey(raw);
    if (!key || GENERIC_KEY.test(key)) continue;
    const entry = counts.get(key) ?? { raw, views: 0 };
    entry.views += 1;
    counts.set(key, entry);
  }
  return withPages([...counts.entries()]
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, take)
    .map(([key, entry]) => ({ key, label: topicLabel(entry.raw, locale), views: entry.views })));
});

/** The link target for a topic, so callers do not rebuild the path. */
export const topicHref = (key: string) => topicPath(key);
