import { prisma } from "./db";
import { licensePermits } from "./macro/market/quality";
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

export function wilsonInterval(successes: number, total: number, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) return null;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
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
    const existing = await prisma.forecast.findUnique({ where: { articleAssetId: signal.id }, select: { status: true } });
    if (existing?.status === "settled") continue;
    if (!targetDate) {
      await prisma.forecast.upsert({
        where: { articleAssetId: signal.id },
        create: { articleAssetId: signal.id, institutionId: article.institutionId, assetId: signal.assetId, forecastDate: article.publishedAt, targetValue: signal.target, direction: signal.direction, metric: "price", forecastType: "UNRESOLVED_HORIZON", status: "excluded", settlementReason: "ambiguous_or_unsupported_horizon" },
        update: { forecastType: "UNRESOLVED_HORIZON", status: "excluded", settlementReason: "ambiguous_or_unsupported_horizon" },
      });
      synced++;
      continue;
    }
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
        forecastType: signal.target === null ? "DIRECTION" : "TARGET_AT_HORIZON",
      },
      update: {
        institutionId: article.institutionId,
        assetId: signal.assetId,
        forecastDate: article.publishedAt,
        targetDate,
        targetValue: signal.target,
        direction: signal.direction,
        forecastType: signal.target === null ? "DIRECTION" : "TARGET_AT_HORIZON",
        status: "pending",
        baseValue: null,
        actualValue: null,
        absoluteError: null,
        percentageError: null,
        directionCorrect: null,
        settlementSource: null,
        baseObservationId: null,
        actualObservationId: null,
        settlementRuleVersion: null,
        settlementReason: null,
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
export const SETTLEMENT_RULE_VERSION = "endpoint-close-v2";

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
    const actualCandidates = await prisma.priceObservation.findMany({
      where: { assetId: forecast.assetId, domain: "MARKET", isProxy: false, priceType: { in: ["LAST", "CLOSE", "SETTLEMENT"] }, timestamp: { gte: forecast.targetDate!, lte: new Date(forecast.targetDate!.getTime() + toleranceMs) } },
      orderBy: { timestamp: "asc" },
      take: 30,
    });
    const actualLicenseKeys = [...new Set(actualCandidates.map((row) => row.licenseKey).filter((key): key is string => Boolean(key)))];
    const actualPolicies = await prisma.dataLicensePolicy.findMany({ where: { datasetKey: { in: actualLicenseKeys } } });
    const actualPolicyByKey = new Map(actualPolicies.map((policy) => [policy.datasetKey, policy]));
    const actual = actualCandidates.find((row) => row.licenseKey && licensePermits(actualPolicyByKey.get(row.licenseKey) ?? null, "internal_analysis", now));
    if (!actual) { await prisma.forecast.update({ where: { id: forecast.id }, data: { settlementReason: "missing_eligible_target_observation", settlementRuleVersion: SETTLEMENT_RULE_VERSION } }); continue; }
    const baseCandidates = await prisma.priceObservation.findMany({
      where: { assetId: forecast.assetId, source: actual.source, domain: actual.domain, unit: actual.unit, priceType: actual.priceType, isProxy: false, timestamp: { gte: new Date(forecast.forecastDate.getTime() - toleranceMs), lte: forecast.forecastDate } },
      orderBy: { timestamp: "desc" },
      take: 30,
    });
    const base = baseCandidates.find((row) => row.licenseKey && licensePermits(actualPolicyByKey.get(row.licenseKey) ?? null, "internal_analysis", now));
    if (!base) { await prisma.forecast.update({ where: { id: forecast.id }, data: { settlementReason: "missing_same_source_base_observation", settlementRuleVersion: SETTLEMENT_RULE_VERSION } }); continue; }
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
        baseObservationId: base.id,
        actualObservationId: actual.id,
        settlementRuleVersion: SETTLEMENT_RULE_VERSION,
        settlementReason: null,
        settledAt: now,
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
  const independent = [...new Map(forecasts.map((forecast) => [`${forecast.assetId}|${forecast.targetDate?.toISOString().slice(0, 10)}|${forecast.forecastType}|${forecast.targetValue ?? forecast.direction}`, forecast])).values()];
  const directional = independent.filter((forecast) => forecast.directionCorrect !== null);
  const directionWins = directional.filter((forecast) => forecast.directionCorrect).length;
  const targetErrors = independent.map((forecast) => forecast.percentageError).filter((value): value is number => value !== null);

  // A bare "0 settled" reads as "this institution has made no calls". These two counts say
  // which it actually is: still waiting, or never scoreable in the first place.
  const [pending, outOfScope, excluded] = await Promise.all([
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
    prisma.forecast.count({ where: { institutionId: institution.id, status: "excluded" } }),
  ]);

  return {
    institution,
    forecasts,
    independentSample: independent.length,
    duplicateCount: forecasts.length - independent.length,
    pending,
    outOfScope,
    excluded,
    directionSample: directional.length,
    directionInterval: wilsonInterval(directionWins, directional.length),
    directionAccuracy: directional.length ? directionWins / directional.length : null,
    meanPercentageError: targetErrors.length ? targetErrors.reduce((sum, value) => sum + value, 0) / targetErrors.length : null,
  };
}
