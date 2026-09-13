import { prisma } from "./db";
import { getMarketMovesForUse } from "./macro/market/read";
import { publicationReadyWhere } from "./publication";
import { buildTradingThemes, THEME_METHODOLOGY_VERSION } from "./tradingThemes";

export async function storeTradingThemeSnapshot(now = new Date()) {
  const since = new Date(now.getTime() - 14 * 864e5);
  const marketSince = new Date(now.getTime() - 8 * 864e5);
  const [views, moves] = await Promise.all([
    prisma.atomicView.findMany({
      where: { reviewStatus: "ok", article: publicationReadyWhere({ publishedAt: { gte: since } }) },
      select: {
        id: true, articleId: true, topic: true, asset: true, assetTicker: true, direction: true,
        importance: true, viewEn: true, viewZh: true, rationaleEn: true, rationaleZh: true,
        conditionEn: true, conditionZh: true,
        article: { select: { slug: true, title: true, publishedAt: true, institutionId: true, institution: { select: { slug: true, name: true, rating: true, authorityScore: true } } } },
      },
    }),
    getMarketMovesForUse(marketSince, now, "internal_analysis"),
  ]);
  const minimumCoverage = Math.min(1, Math.max(0, Number(process.env.THEME_MARKET_MIN_COVERAGE || 0.6)));
  const themes = buildTradingThemes(views, now, moves, minimumCoverage);
  const compact = themes.map((theme) => ({ key: theme.key, score: theme.score, status: theme.status, direction: theme.direction, marketStatus: theme.marketStatus, marketCoverage: theme.marketCoverage, viewCount: theme.viewCount, institutionCount: theme.institutionCount }));
  return prisma.tradingThemeSnapshot.create({ data: {
    methodologyVersion: THEME_METHODOLOGY_VERSION,
    generatedAt: now,
    themesJson: JSON.stringify(compact),
    inputViewIds: JSON.stringify(views.map((view) => view.id)),
    inputObservationIds: JSON.stringify([...new Set(moves.flatMap((move) => move.observationIds ?? []))]),
    coverageJson: JSON.stringify({ minimumCoverage, moves: moves.map((move) => ({ symbol: move.symbol, observations: move.observationIds?.length ?? 0 })) }),
  } });
}
