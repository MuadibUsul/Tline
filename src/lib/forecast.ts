import { prisma } from "./db";

const HORIZON_DAYS: Record<string, number> = { "1W": 7, "1M": 30, "3M": 90, "12M": 365 };

export function targetDateForHorizon(start: Date, horizon: string | null) {
  const days = horizon ? HORIZON_DAYS[horizon.toUpperCase()] : undefined;
  return days ? new Date(start.getTime() + days * 86_400_000) : null;
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

export async function settleDueForecasts(now = new Date()) {
  const toleranceMs = Math.max(1, Number(process.env.PRICE_SETTLEMENT_TOLERANCE_DAYS || 7)) * 86_400_000;
  const forecasts = await prisma.forecast.findMany({
    where: { status: "pending", targetDate: { not: null, lte: now } },
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
  return {
    institution,
    forecasts,
    directionAccuracy: directional.length ? directional.filter((forecast) => forecast.directionCorrect).length / directional.length : null,
    meanPercentageError: targetErrors.length ? targetErrors.reduce((sum, value) => sum + value, 0) / targetErrors.length : null,
  };
}
