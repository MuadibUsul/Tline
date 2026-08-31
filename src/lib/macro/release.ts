import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { getMacroReleaseFamily } from "./registry";

export const MACRO_RELEASE_STATUSES = ["SCHEDULED", "WAITING", "RELEASED", "DELAYED", "CANCELLED", "FAILED"] as const;
export type MacroReleaseStatus = typeof MACRO_RELEASE_STATUSES[number];
export type CalendarSourceKind = "OFFICIAL" | "FRED" | "MANUAL";

export interface CalendarReleaseCandidate {
  releaseFamily: string;
  externalReleaseId: string;
  scheduledAt: Date;
  sourceTimezone: string;
  sourceUrl: string;
  sourceKind: CalendarSourceKind;
  status?: MacroReleaseStatus;
}

interface StoredRelease {
  id: string;
  scheduledAt: Date;
  status: string;
  sourceUrl: string | null;
  sourceTimezone: string;
}

interface ReleaseWrite {
  releaseKey: string;
  releaseFamily: string;
  countryCode: string;
  currency: string | null;
  agency: string;
  titleEn: string;
  titleZh: string;
  scheduledAt: Date;
  sourceTimezone: string;
  importance: number;
  status: MacroReleaseStatus;
  sourceUrl: string;
  externalReleaseId: string;
}

export interface ReleaseRepository {
  find(releaseKey: string): Promise<StoredRelease | null>;
  findAt(releaseFamily: string, scheduledAt: Date): Promise<StoredRelease | null>;
  create(data: ReleaseWrite): Promise<{ id: string }>;
  update(id: string, data: ReleaseWrite): Promise<void>;
}

const sourcePriority = (kind: CalendarSourceKind) => kind === "OFFICIAL" ? 10 : kind === "FRED" ? 20 : 30;
const storedPriority = (url: string | null) => {
  if (!url) return 30;
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(".gov")) return 10;
  if (host === "fred.stlouisfed.org" || host === "api.stlouisfed.org") return 20;
  return 30;
};

export function macroReleaseKey(releaseFamily: string, externalReleaseId: string): string {
  const identity = externalReleaseId.trim();
  if (!identity) throw new Error("Macro release external identity is required.");
  const digest = createHash("sha256").update(`${releaseFamily}:${identity}`).digest("hex").slice(0, 24);
  return `macro:${releaseFamily.toLowerCase()}:${digest}`;
}

export async function persistCalendarRelease(repository: ReleaseRepository, candidate: CalendarReleaseCandidate) {
  const family = getMacroReleaseFamily(candidate.releaseFamily);
  if (!family) throw new Error(`Unknown macro release family ${candidate.releaseFamily}.`);
  if (candidate.sourceTimezone !== family.normalTimezone) throw new Error(`Unexpected timezone for ${candidate.releaseFamily}.`);
  if (Number.isNaN(candidate.scheduledAt.getTime())) throw new Error("Invalid macro release scheduledAt.");
  const status = candidate.status ?? "SCHEDULED";
  if (!MACRO_RELEASE_STATUSES.includes(status)) throw new Error(`Invalid macro release status ${status}.`);
  const releaseKey = macroReleaseKey(candidate.releaseFamily, candidate.externalReleaseId);
  const existing = await repository.find(releaseKey) ?? await repository.findAt(candidate.releaseFamily, candidate.scheduledAt);
  if (existing && sourcePriority(candidate.sourceKind) > storedPriority(existing.sourceUrl)) {
    return { status: "unchanged" as const, id: existing.id, releaseKey };
  }
  const terminal = existing && ["RELEASED", "CANCELLED"].includes(existing.status);
  const data: ReleaseWrite = {
    releaseKey,
    releaseFamily: family.key,
    countryCode: family.countryCode,
    currency: "USD",
    agency: family.agency,
    titleEn: family.titleEn,
    titleZh: family.titleZh,
    scheduledAt: candidate.scheduledAt,
    sourceTimezone: candidate.sourceTimezone,
    importance: family.importance,
    status: terminal ? existing.status as MacroReleaseStatus : status,
    sourceUrl: candidate.sourceUrl,
    externalReleaseId: candidate.externalReleaseId,
  };
  if (!existing) {
    const created = await repository.create(data);
    return { status: "created" as const, id: created.id, releaseKey };
  }
  const unchanged = existing.scheduledAt.getTime() === data.scheduledAt.getTime()
    && existing.status === data.status
    && existing.sourceUrl === data.sourceUrl
    && existing.sourceTimezone === data.sourceTimezone;
  if (unchanged) return { status: "unchanged" as const, id: existing.id, releaseKey };
  await repository.update(existing.id, data);
  return { status: "updated" as const, id: existing.id, releaseKey };
}

type MacroPrisma = Prisma.TransactionClient | PrismaClient;

function prismaReleaseRepository(client: MacroPrisma): ReleaseRepository {
  return {
    find: (releaseKey) => client.macroRelease.findUnique({
      where: { releaseKey },
      select: { id: true, scheduledAt: true, status: true, sourceUrl: true, sourceTimezone: true },
    }),
    findAt: (releaseFamily, scheduledAt) => client.macroRelease.findFirst({
      where: { releaseFamily, scheduledAt },
      select: { id: true, scheduledAt: true, status: true, sourceUrl: true, sourceTimezone: true },
    }),
    create: (data) => client.macroRelease.create({ data, select: { id: true } }),
    update: async (id, data) => { await client.macroRelease.update({ where: { id }, data }); },
  };
}

export function storeCalendarRelease(candidate: CalendarReleaseCandidate) {
  return prisma.$transaction((transaction) => persistCalendarRelease(prismaReleaseRepository(transaction), candidate));
}
