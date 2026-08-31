import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { stableStringify } from "./normalize";
import { macroIndicators, macroSources } from "./registry";
import { decideRevision, type StoredObservationRevision } from "./revisions";
import type { NormalizedObservation } from "./types";

interface StoredSource {
  id: string;
  canonicalKey: string;
}

interface ObservationInsert {
  seriesSourceId: string;
  period: Date;
  value: Prisma.Decimal;
  vintageAt: Date;
  fetchedAt: Date;
  isInitial: boolean;
  revisionNo: number;
  status: string;
  sourcePublishedAt: Date | null;
  rawHash: string | null;
  metadata: string | null;
}

export interface ObservationRepository {
  findSource(provider: string, externalSeriesId: string): Promise<StoredSource | null>;
  listHistory(seriesSourceId: string, period: Date): Promise<StoredObservationRevision[]>;
  createObservation(data: ObservationInsert): Promise<{ id: string }>;
}

export type StoreObservationResult = {
  status: "inserted" | "unchanged";
  id: string;
  revisionNo: number;
  isInitial: boolean;
};

export async function persistNormalizedObservation(
  repository: ObservationRepository,
  observation: NormalizedObservation,
): Promise<StoreObservationResult> {
  const source = await repository.findSource(observation.provider, observation.externalSeriesId);
  if (!source) throw new Error(`Macro source is not registered: ${observation.provider}:${observation.externalSeriesId}.`);
  if (source.canonicalKey !== observation.canonicalKey) throw new Error("Macro source canonical mapping mismatch.");
  const history = await repository.listHistory(source.id, observation.period);
  const decision = decideRevision(history, observation);
  if (decision.action === "unchanged") {
    return {
      status: "unchanged",
      id: decision.existing.id,
      revisionNo: decision.existing.revisionNo,
      isInitial: decision.existing.isInitial,
    };
  }
  const created = await repository.createObservation({
    seriesSourceId: source.id,
    period: observation.period,
    value: new Prisma.Decimal(observation.value),
    vintageAt: observation.vintageAt,
    fetchedAt: observation.fetchedAt,
    isInitial: decision.isInitial,
    revisionNo: decision.revisionNo,
    status: observation.status,
    sourcePublishedAt: observation.sourcePublishedAt,
    rawHash: observation.rawHash,
    metadata: observation.metadata ? stableStringify(observation.metadata) : null,
  });
  return { status: "inserted", id: created.id, revisionNo: decision.revisionNo, isInitial: decision.isInitial };
}

type MacroPrisma = Prisma.TransactionClient | PrismaClient;

function prismaRepository(client: MacroPrisma): ObservationRepository {
  return {
    async findSource(provider, externalSeriesId) {
      const source = await client.macroSeriesSource.findUnique({
        where: { provider_externalSeriesId: { provider, externalSeriesId } },
        select: { id: true, indicator: { select: { canonicalKey: true } } },
      });
      return source ? { id: source.id, canonicalKey: source.indicator.canonicalKey } : null;
    },
    async listHistory(seriesSourceId, period) {
      const rows = await client.macroObservation.findMany({
        where: { seriesSourceId, period },
        orderBy: { revisionNo: "asc" },
        select: { id: true, value: true, status: true, vintageAt: true, revisionNo: true, isInitial: true },
      });
      return rows.map((row) => ({ ...row, value: row.value.toString() }));
    },
    createObservation(data) {
      return client.macroObservation.create({ data, select: { id: true } });
    },
  };
}

export function storeNormalizedObservation(observation: NormalizedObservation) {
  return prisma.$transaction((transaction) => persistNormalizedObservation(prismaRepository(transaction), observation));
}

/** Idempotently materialize the committed JSON registry in the database. */
export async function syncMacroRegistry(client: PrismaClient = prisma) {
  return client.$transaction(async (transaction) => {
    const indicatorIds = new Map<string, string>();
    for (const indicator of macroIndicators) {
      const row = await transaction.macroIndicator.upsert({
        where: { canonicalKey: indicator.canonicalKey },
        create: indicator,
        update: indicator,
        select: { id: true },
      });
      indicatorIds.set(indicator.canonicalKey, row.id);
    }
    for (const source of macroSources) {
      const indicatorId = indicatorIds.get(source.canonicalKey);
      if (!indicatorId) throw new Error(`Missing macro indicator ${source.canonicalKey}.`);
      const data = {
        indicatorId,
        provider: source.provider,
        externalSeriesId: source.externalSeriesId,
        dataset: source.dataset ?? null,
        tableCode: source.tableCode ?? null,
        lineCode: source.lineCode ?? null,
        priority: source.priority,
        sourceUrl: source.sourceUrl ?? null,
        metadata: source.metadata ? stableStringify(source.metadata) : null,
        enabled: source.enabled,
      };
      await transaction.macroSeriesSource.upsert({
        where: { provider_externalSeriesId: { provider: source.provider, externalSeriesId: source.externalSeriesId } },
        create: data,
        update: data,
      });
    }
    await transaction.macroSeriesSource.updateMany({
      where: { NOT: { OR: macroSources.map(({ provider, externalSeriesId }) => ({ provider, externalSeriesId })) } },
      data: { enabled: false },
    });
    return { indicators: macroIndicators.length, sources: macroSources.length };
  });
}
