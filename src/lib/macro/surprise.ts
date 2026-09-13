import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export function calculateSurprise(actual: Prisma.Decimal.Value | null, consensus: Prisma.Decimal.Value | null) {
  if (actual === null || consensus === null) return { surpriseRaw: null, surprisePct: null };
  const actualValue = new Prisma.Decimal(actual);
  const consensusValue = new Prisma.Decimal(consensus);
  const surpriseRaw = actualValue.minus(consensusValue);
  return { surpriseRaw, surprisePct: consensusValue.isZero() ? null : surpriseRaw.dividedBy(consensusValue.abs()) };
}

export function surpriseDisplayUnit(unit: string) {
  if (unit === "PERCENT" || unit === "PERCENTAGE") return "percentage_points";
  if (unit === "BASIS_POINTS" || unit === "BPS") return "basis_points";
  return unit || "indicator_units";
}

export function calculateSurpriseDetail(actual: Prisma.Decimal.Value | null, consensus: Prisma.Decimal.Value | null, unit: string) {
  if (actual === null) return { ...calculateSurprise(actual, consensus), displayUnit: surpriseDisplayUnit(unit), reason: "actual_missing" as const };
  if (consensus === null) return { ...calculateSurprise(actual, consensus), displayUnit: surpriseDisplayUnit(unit), reason: "verified_consensus_missing" as const };
  return { ...calculateSurprise(actual, consensus), displayUnit: surpriseDisplayUnit(unit), reason: null };
}

export function standardizeSurprise(current: Prisma.Decimal.Value, priorErrors: Prisma.Decimal.Value[], minimumSamples = 12) {
  if (priorErrors.length < minimumSamples) return { zScore: null, reason: "insufficient_prior_samples" as const };
  const values = priorErrors.map(Number);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return { zScore: null, reason: "zero_prior_variance" as const };
  return { zScore: (Number(current) - mean) / deviation, reason: null };
}

export async function recomputeReleaseSurprises(releaseId: string) {
  const values = await prisma.macroReleaseValue.findMany({ where: { releaseId }, select: { id: true, actualInitial: true, consensusAtRelease: true, consensusExpectationId: true } });
  for (const value of values) {
    const result = calculateSurprise(value.actualInitial, value.consensusExpectationId ? value.consensusAtRelease : null);
    await prisma.macroReleaseValue.update({ where: { id: value.id }, data: result });
  }
  return { releaseId, values: values.length, withConsensus: values.filter((value) => value.actualInitial !== null && value.consensusExpectationId !== null && value.consensusAtRelease !== null).length };
}

export interface RevisionMetricInput {
  id: string;
  value: Prisma.Decimal.Value;
  revisionNo: number;
  vintageAt: Date;
}

export function revisionMetrics(history: RevisionMetricInput[]) {
  const ordered = [...history].sort((left, right) => left.revisionNo - right.revisionNo || left.vintageAt.getTime() - right.vintageAt.getTime());
  if (!ordered.length) return null;
  const initial = new Prisma.Decimal(ordered[0].value);
  const latest = new Prisma.Decimal(ordered.at(-1)!.value);
  const revisionDelta = latest.minus(initial);
  return {
    initial,
    latest,
    revisionDelta,
    revisionPct: initial.isZero() ? null : revisionDelta.dividedBy(initial.abs()),
    revisionCount: Math.max(0, ordered.length - 1),
    observationIds: ordered.map((item) => item.id),
  };
}
