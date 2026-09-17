import { prisma } from "./db";
import { publicationReadyWhere } from "./publication";
import { buildTradingThemes } from "./tradingThemes";
import { getMarketMovesForUse } from "./macro/market/read";

/**
 * The themes the desk is currently showing.
 *
 * Shared by the public summary page and the sitemap, so the two cannot disagree about whether
 * there is anything to list: a page that answers noindex while the sitemap advertises it is
 * the contradiction this exists to avoid.
 */
const WINDOW_DAYS = 14;
const MARKET_DAYS = 8;

export async function loadPublicThemes() {
  const now = new Date();
  const [views, marketMoves] = await Promise.all([
    prisma.atomicView.findMany({
      where: { reviewStatus: "ok", article: publicationReadyWhere({ publishedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * 864e5) } }) },
      select: {
        id: true, articleId: true, topic: true, asset: true, assetTicker: true, direction: true, importance: true,
        viewEn: true, viewZh: true, rationaleEn: true, rationaleZh: true, conditionEn: true, conditionZh: true,
        article: { select: { slug: true, title: true, publishedAt: true, institutionId: true, institution: { select: { slug: true, name: true, rating: true, authorityScore: true } } } },
      },
    }),
    getMarketMovesForUse(new Date(now.getTime() - MARKET_DAYS * 864e5), now),
  ]);
  const coverage = Math.min(1, Math.max(0, Number(process.env.THEME_MARKET_MIN_COVERAGE || 0.6)));
  return buildTradingThemes(views, now, marketMoves, coverage);
}
