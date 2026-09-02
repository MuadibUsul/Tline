import { prisma } from "./db";
import { horizonTargetDate } from "./forecastHorizon";

/**
 * The extractor stores the institution's own wording ("short_term", "3-6 months",
 * "H2 2026"), never a canonical code, so horizon parsing lives in `forecastHorizon`.
 */
export function targetDateForHorizon(start: Date, horizon: string | null) {
  return horizonTargetDate(start, horizon);
}

export function calculateSettlement(input: {
  targetValue: number | null;
  direction: number | null;
  baseValue: number;
  actualValue: number;
  neutralBand?: number;
}) {
  const absoluteError = input.targetValue === null ? null : Math.abs(input.actualValue - input.targetValue);
  const percentageError = input.targetValue === null || input.targetValue === 0
    ? null
    : absoluteError! / Math.abs(input.targetValue) * 100;
  const change = (input.actualValue - input.baseValue) / Math.abs(input.baseValue || 1);
  const band = input.neutralBand ?? 0.01;
  const directionCorrect = input.direction === null
    ? null
    : input.direction > 0
      ? change > 0
      : input.direction < 0
        ? change < 0
        : Math.abs(change) <= band;
  return { absoluteError, percentageError, directionCorrect };
}

export async function syncForecastsForArticle(articleId: string) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { articleAssets: true },
  });
  if (!article) return 0;
  let synced = 0;
  for (const signal of article.articleAssets) {
    const targetDate = targetDateForHorizon(article.publishedAt, signal.timeHorizon);
    if (!targetDate) continue;
    await prisma.forecast.upsert({
      where: { articleAssetId: signal.id },
      create: {
        articleAssetId: signal.id,
        institutionId: article.institutionId,
        assetId: signal.assetId,
        forecastDate: article.publishedAt,
        targetDate,
        targetValue: signal.target,
        direction: signal.direction,
        metric: "price",
      },
      update: {
        institutionId: article.institutionId,
        assetId: signal.assetId,
        forecastDate: article.publishedAt,
        targetDate,
        targetValue: signal.target,
        direction: signal.direction,
        status: "pending",
        baseValue: null,
        actualValue: null,
        absoluteError: null,
        percentageError: null,
        directionCorrect: null,
        settlementSource: null,
        settledAt: null,
      },
    });
    synced++;
  }
  return synced;
}

export async function syncAllForecasts() {
  const articles = await prisma.article.findMany({
    where: { articleAssets: { some: { timeHorizon: { not: null } } } },
    select: { id: true },
  });
  let total = 0;
  for (const article of articles) total += await syncForecastsForArticle(article.id);
  return total;
}

/**
 * Asset classes whose forecasts can be scored against a price.
 *
 * `rate` and `macro` are excluded deliberately. An institution that is "bullish on US 10Y
 * Treasuries" means yields fall, but the only series available is the yield itself, so
 * scoring direction against it inverts the verdict. "Bullish on the Fed" or "on inflation"
 * is a policy stance, not a price call, and has no price to settle against at all. Rather
 * than publish an accuracy figure that is confidently backwards, those forecasts stay
 * pending and are reported as out of scope.
 */
export const SETTLEABLE_ASSET_CLASSES = ["equity", "fx", "commodity", "crypto"] as const;

export async function settleDueForecasts(now = new Date()) {
  const toleranceMs = Math.max(1, Number(process.env.PRICE_SETTLEMENT_TOLERANCE_DAYS || 7)) * 86_400_000;
  const forecasts = await prisma.forecast.findMany({
    where: {
      status: "pending",
      targetDate: { not: null, lte: now },
      asset: { assetClass: { in: [...SETTLEABLE_ASSET_CLASSES] } },
    },
  });
  let settled = 0;
  for (const forecast of forecasts) {
    const actual = await prisma.priceObservation.findFirst({
      where: { assetId: forecast.assetId, timestamp: { gte: forecast.targetDate! } },
      orderBy: { timestamp: "asc" },
    });
    if (!actual || actual.timestamp.getTime() - forecast.targetDate!.getTime() > toleranceMs) continue;
    const base = await prisma.priceObservation.findFirst({
      where: { assetId: forecast.assetId, source: actual.source, timestamp: { lte: forecast.forecastDate } },
      orderBy: { timestamp: "desc" },
    });
    if (!base || forecast.forecastDate.getTime() - base.timestamp.getTime() > toleranceMs) continue;
    const result = calculateSettlement({
      targetValue: forecast.targetValue,
      direction: forecast.direction,
      baseValue: base.value,
      actualValue: actual.value,
    });
    await prisma.forecast.update({
      where: { id: forecast.id },
      data: {
        status: "settled",
        baseValue: base.value,
        actualValue: actual.value,
        absoluteError: result.absoluteError,
        percentageError: result.percentageError,
        directionCorrect: result.directionCorrect,
        settlementSource: actual.source,
        settledAt: new Date(),
      },
    });
    settled++;
  }
  return { due: forecasts.length, settled };
}

export async function getInstitutionAccuracy(slug: string) {
  const institution = await prisma.institution.findUnique({ where: { slug } });
  if (!institution) return null;
  const forecasts = await prisma.forecast.findMany({
    where: { institutionId: institution.id, status: "settled" },
    include: { asset: true },
    orderBy: { targetDate: "desc" },
  });
  const directional = forecasts.filter((forecast) => forecast.directionCorrect !== null);
  const targetErrors = forecasts.map((forecast) => forecast.percentageError).filter((value): value is number => value !== null);

  // A bare "0 settled" reads as "this institution has made no calls". These two counts say
  // which it actually is: still waiting, or never scoreable in the first place.
  const [pending, outOfScope] = await Promise.all([
    prisma.forecast.count({
      where: {
        institutionId: institution.id,
        status: "pending",
        asset: { assetClass: { in: [...SETTLEABLE_ASSET_CLASSES] } },
      },
    }),
    prisma.forecast.count({
      where: {
        institutionId: institution.id,
        asset: { assetClass: { notIn: [...SETTLEABLE_ASSET_CLASSES] } },
      },
    }),
  ]);

  return {
    institution,
    forecasts,
    pending,
    outOfScope,
    directionAccuracy: directional.length ? directional.filter((forecast) => forecast.directionCorrect).length / directional.length : null,
    meanPercentageError: targetErrors.length ? targetErrors.reduce((sum, value) => sum + value, 0) / targetErrors.length : null,
  };
}
