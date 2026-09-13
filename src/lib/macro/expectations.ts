import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { licensePermits } from "./market/quality";

export const EXPECTATION_TYPES = ["SURVEY_CONSENSUS", "MODEL_FORECAST", "INSTITUTION_FORECAST"] as const;
export type ExpectationType = typeof EXPECTATION_TYPES[number];

export interface ExpectationMatchInput {
  releaseId: string;
  indicatorId: string;
  referencePeriod: Date;
  releaseStage: string;
  unit: string;
  seasonalAdjustment: string | null;
  capturedAt: Date;
  sourcePublishedAt: Date | null;
  historicalReconstruction: boolean;
}

export function expectationEligibleBeforeRelease(expectation: ExpectationMatchInput, target: Omit<ExpectationMatchInput, "capturedAt" | "sourcePublishedAt" | "historicalReconstruction"> & { scheduledAt: Date }) {
  return expectation.releaseId === target.releaseId
    && expectation.indicatorId === target.indicatorId
    && expectation.referencePeriod.getTime() === target.referencePeriod.getTime()
    && expectation.releaseStage === target.releaseStage
    && expectation.unit === target.unit
    && expectation.seasonalAdjustment === target.seasonalAdjustment
    && !expectation.historicalReconstruction
    && expectation.capturedAt <= target.scheduledAt
    && (!expectation.sourcePublishedAt || expectation.sourcePublishedAt <= target.scheduledAt);
}

export function latestEligibleExpectation<T extends ExpectationMatchInput>(items: T[], target: Parameters<typeof expectationEligibleBeforeRelease>[1]) {
  return items.filter((item) => expectationEligibleBeforeRelease(item, target)).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0] ?? null;
}

export async function recordMacroExpectation(input: {
  releaseId: string; indicatorId: string; referencePeriod: Date; releaseStage?: string; type: ExpectationType;
  source: string; sourceEventId?: string; rawField?: string; sourceUrl?: string; licenseKey?: string; value: Prisma.Decimal.Value;
  unit: string; seasonalAdjustment?: string | null; annualization?: string | null; sourcePublishedAt?: Date | null;
  capturedAt?: Date; sampleSize?: number | null; surveyMethod?: string | null; entryMethod?: string; operatorId?: string;
  historicalReconstruction?: boolean;
}) {
  if (!EXPECTATION_TYPES.includes(input.type)) throw new Error("Unsupported expectation type.");
  if (!input.source.trim() || !input.unit.trim()) throw new Error("Expectation source and unit are required.");
  return prisma.$transaction(async (tx) => {
    const latest = await tx.macroExpectation.findFirst({ where: { releaseId: input.releaseId, indicatorId: input.indicatorId, type: input.type, source: input.source }, orderBy: { revisionNo: "desc" }, select: { revisionNo: true } });
    return tx.macroExpectation.create({ data: { ...input, value: new Prisma.Decimal(input.value), releaseStage: input.releaseStage ?? "INITIAL", capturedAt: input.capturedAt ?? new Date(), entryMethod: input.entryMethod ?? "MANUAL", historicalReconstruction: input.historicalReconstruction ?? false, revisionNo: (latest?.revisionNo ?? -1) + 1 } });
  });
}

export async function freezeReleaseExpectations(releaseId: string) {
  const release = await prisma.macroRelease.findUniqueOrThrow({ where: { id: releaseId }, include: { values: { include: { indicator: true } }, expectations: true } });
  const licenseKeys = [...new Set(release.expectations.map((item) => item.licenseKey).filter((item): item is string => Boolean(item)))];
  const policies = await prisma.dataLicensePolicy.findMany({ where: { datasetKey: { in: licenseKeys } } });
  const policyByKey = new Map(policies.map((policy) => [policy.datasetKey, policy]));
  const authorized = release.expectations.filter((item) => item.licenseKey && licensePermits(policyByKey.get(item.licenseKey) ?? null, "internal_analysis"));
  let frozen = 0;
  for (const value of release.values) {
    const target = { releaseId, indicatorId: value.indicatorId, referencePeriod: value.observationPeriod, releaseStage: "INITIAL", unit: value.indicator.unit, seasonalAdjustment: value.indicator.seasonalAdjustment, scheduledAt: release.scheduledAt };
    const consensus = latestEligibleExpectation(authorized.filter((item) => item.type === "SURVEY_CONSENSUS"), target);
    const model = latestEligibleExpectation(authorized.filter((item) => item.type === "MODEL_FORECAST"), target);
    await prisma.macroReleaseValue.update({ where: { id: value.id }, data: {
      ...(value.consensusExpectationId || !consensus ? {} : { consensusExpectationId: consensus.id, consensusAtRelease: consensus.value, consensusProvider: consensus.source, consensusAsOf: consensus.capturedAt }),
      ...(value.modelExpectationId || !model ? {} : { modelExpectationId: model.id }),
    } });
    if (consensus || model) frozen++;
  }
  return { releaseId, values: release.values.length, frozen };
}
