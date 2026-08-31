import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export function calculateSurprise(actual: Prisma.Decimal.Value | null, consensus: Prisma.Decimal.Value | null) {
  if (actual === null || consensus === null) return { surpriseRaw: null, surprisePct: null };
  const actualValue = new Prisma.Decimal(actual);
  const consensusValue = new Prisma.Decimal(consensus);
  const surpriseRaw = actualValue.minus(consensusValue);
  return { surpriseRaw, surprisePct: consensusValue.isZero() ? null : surpriseRaw.dividedBy(consensusValue.abs()) };
}

export async function recomputeReleaseSurprises(releaseId: string) {
  const values = await prisma.macroReleaseValue.findMany({ where: { releaseId }, select: { id: true, actualInitial: true, consensusAtRelease: true } });
  for (const value of values) {
    const result = calculateSurprise(value.actualInitial, value.consensusAtRelease);
    await prisma.macroReleaseValue.update({ where: { id: value.id }, data: result });
  }
  return { releaseId, values: values.length, withConsensus: values.filter((value) => value.actualInitial !== null && value.consensusAtRelease !== null).length };
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
