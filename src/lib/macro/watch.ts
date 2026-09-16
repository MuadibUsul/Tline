import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createMacroProvider } from "./providers";
import { MacroProviderError } from "./providers/types";
import { getMacroReleaseFamily, getMacroSources } from "./registry";
import { generateReleaseAnalysis } from "./releaseAnalysis";
import { freezeReleaseExpectations } from "./expectations";
import { recomputeReleaseSurprises } from "./surprise";
import { storeNormalizedObservation, syncMacroRegistry } from "./store";
import type { MacroReleaseFamilyDefinition, NormalizedObservation } from "./types";

export type WatchPhase = "warmup" | "hot" | "late" | "expired" | "outside";

export interface WatchSchedule {
  phase: WatchPhase;
  intervalSeconds: number | null;
}

const TARGETS: Record<string, { kind: "MONTHLY" | "QUARTERLY" | "EVENT_DATE" | "EXTERNAL_DATE"; lag: number }> = {
  BLS_CPI: { kind: "MONTHLY", lag: 1 },
  BLS_EMPLOYMENT_SITUATION: { kind: "MONTHLY", lag: 1 },
  BLS_PPI: { kind: "MONTHLY", lag: 1 },
  BLS_JOLTS: { kind: "MONTHLY", lag: 2 },
  BEA_PERSONAL_INCOME_OUTLAYS: { kind: "MONTHLY", lag: 1 },
  BEA_GDP: { kind: "QUARTERLY", lag: 1 },
  FOMC_DECISION: { kind: "EVENT_DATE", lag: 0 },
  EIA_PETROLEUM_STATUS: { kind: "EXTERNAL_DATE", lag: 0 },
};

const providers = new Map<string, ReturnType<typeof createMacroProvider>>();

function provider(name: string) {
  const existing = providers.get(name);
  if (existing) return existing;
  const created = createMacroProvider(name);
  providers.set(name, created);
  return created;
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function releaseTargetPeriod(
  releaseFamily: string,
  scheduledAt: Date,
  sourceTimezone: string,
  externalReleaseId: string | null,
): Date {
  const target = TARGETS[releaseFamily];
  if (!target) throw new Error(`No target-period rule for ${releaseFamily}.`);
  if (target.kind === "EXTERNAL_DATE") {
    const match = externalReleaseId?.match(/(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error(`Release ${releaseFamily} has no target date in its external identity.`);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const local = dateParts(scheduledAt, sourceTimezone);
  if (target.kind === "EVENT_DATE") return new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (target.kind === "MONTHLY") return new Date(Date.UTC(local.year, local.month - 1 - target.lag, 1));
  const scheduledQuarter = Math.floor((local.month - 1) / 3);
  return new Date(Date.UTC(local.year, (scheduledQuarter - target.lag) * 3, 1));
}

export function previousObservationPeriod(period: Date, releaseFamily: string): Date | null {
  const target = TARGETS[releaseFamily];
  if (!target || target.kind === "EVENT_DATE") return null;
  if (target.kind === "MONTHLY") return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 1, 1));
  if (target.kind === "QUARTERLY") return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 3, 1));
  return new Date(period.getTime() - 7 * 86_400_000);
}

export function watchSchedule(scheduledAt: Date, now: Date, family: MacroReleaseFamilyDefinition): WatchSchedule {
  const secondsUntil = (scheduledAt.getTime() - now.getTime()) / 1000;
  const strategy = family.pollingStrategy;
  const warmupMinutes = strategy.warmupMinutesBefore ?? 30;
  const hotMinutes = strategy.startMinutesBefore ?? 10;
  const hotInterval = strategy.intervalSeconds ?? 60;
  if (secondsUntil > warmupMinutes * 60) return { phase: "outside", intervalSeconds: null };
  if (secondsUntil > hotMinutes * 60) return { phase: "warmup", intervalSeconds: strategy.warmupIntervalSeconds ?? 300 };
  if (secondsUntil > 0) return { phase: "hot", intervalSeconds: hotInterval };
  if (-secondsUntil <= (strategy.stopMinutesAfter ?? 120) * 60) {
    return { phase: "late", intervalSeconds: strategy.lateIntervalSeconds ?? Math.max(30, Math.min(60, hotInterval)) };
  }
  return { phase: "expired", intervalSeconds: null };
}

export function isFreshReleaseObservation(
  observation: NormalizedObservation,
  targetPeriod: Date,
  scheduledAt: Date,
  previous: { value: Prisma.Decimal | string; fetchedAt: Date } | null,
): boolean {
  if (observation.period.getTime() !== targetPeriod.getTime() || observation.fetchedAt < scheduledAt) return false;
  if (!['PUBLISHED', 'PRELIMINARY'].includes(observation.status)) return false;
  if (observation.sourcePublishedAt) {
    const publishedDate = observation.sourcePublishedAt.toISOString().slice(0, 10);
    const scheduledDate = scheduledAt.toISOString().slice(0, 10);
    return publishedDate >= scheduledDate;
  }
  if (!previous || previous.fetchedAt >= scheduledAt) return true;
  return new Prisma.Decimal(observation.value).comparedTo(previous.value) !== 0;
}

type ReleaseRow = {
  id: string;
  releaseKey: string;
  releaseFamily: string;
  scheduledAt: Date;
  sourceTimezone: string;
  externalReleaseId: string | null;
  releasedAt: Date | null;
};

async function latestObservation(seriesSourceId: string, period: Date, before?: Date) {
  return prisma.macroObservation.findFirst({
    where: { seriesSourceId, period, ...(before ? { fetchedAt: { lt: before } } : {}) },
    orderBy: [{ vintageAt: "desc" }, { revisionNo: "desc" }],
    select: { value: true, fetchedAt: true },
  });
}

/**
 * The same lookup across every source of an indicator. A release value belongs to the
 * indicator, not to one series, and the source that captures a print may not carry the
 * previous period's history — the print-time CSV has none on its first use. Fall back to
 * the most recent vintage among the indicator's other official sources.
 */
async function latestIndicatorObservation(canonicalKey: string, period: Date, before: Date, excludeSourceId: string) {
  const sources = await prisma.macroSeriesSource.findMany({
    where: { indicator: { canonicalKey }, id: { not: excludeSourceId } },
    select: { id: true },
  });
  if (!sources.length) return null;
  return prisma.macroObservation.findFirst({
    where: { seriesSourceId: { in: sources.map((source) => source.id) }, period, fetchedAt: { lt: before } },
    orderBy: [{ vintageAt: "desc" }, { revisionNo: "desc" }],
    select: { value: true, fetchedAt: true },
  });
}

async function pollIndicator(release: ReleaseRow, canonicalKey: string, targetPeriod: Date, now: Date) {
  const previousPeriod = previousObservationPeriod(targetPeriod, release.releaseFamily);
  const errors: Array<{ provider: string; code: string }> = [];
  for (const source of getMacroSources(canonicalKey)) {
    const storedSource = await prisma.macroSeriesSource.findUnique({
      where: { provider_externalSeriesId: { provider: source.provider, externalSeriesId: source.externalSeriesId } },
      select: { id: true },
    });
    if (!storedSource) throw new Error(`Macro registry is missing ${source.provider}:${source.externalSeriesId}.`);
    const beforeTarget = await latestObservation(storedSource.id, targetPeriod);
    const previousAtRelease = previousPeriod
      ? (await latestObservation(storedSource.id, previousPeriod, release.scheduledAt))
        ?? (await latestIndicatorObservation(canonicalKey, previousPeriod, release.scheduledAt, storedSource.id))
      : null;
    try {
      const rows = await provider(source.provider).fetchSeries({
        externalSeriesId: source.externalSeriesId,
        from: previousPeriod ?? targetPeriod,
        to: targetPeriod,
      });
      for (const row of rows) await storeNormalizedObservation(row);
      const candidate = rows
        .filter((row) => row.period.getTime() === targetPeriod.getTime())
        .sort((left, right) => right.vintageAt.getTime() - left.vintageAt.getTime())[0];
      console.log(JSON.stringify({ event: "macro.release.poll", releaseKey: release.releaseKey, indicator: canonicalKey, provider: source.provider, targetPeriod: targetPeriod.toISOString(), found: Boolean(candidate) }));
      if (!candidate || now < release.scheduledAt || !isFreshReleaseObservation(candidate, targetPeriod, release.scheduledAt, beforeTarget)) continue;
      const returnedPrevious = previousPeriod
        ? rows.filter((row) => row.period.getTime() === previousPeriod.getTime()).sort((a, b) => b.vintageAt.getTime() - a.vintageAt.getTime())[0]
        : null;
      const revisedPrevious = previousAtRelease && returnedPrevious
        && new Prisma.Decimal(returnedPrevious.value).comparedTo(previousAtRelease.value) !== 0
        ? returnedPrevious.value
        : null;
      const indicator = await prisma.macroIndicator.findUnique({ where: { canonicalKey }, select: { id: true } });
      if (!indicator) throw new Error(`Macro indicator ${canonicalKey} is not materialized.`);
      await prisma.macroReleaseValue.upsert({
        where: { releaseId_indicatorId: { releaseId: release.id, indicatorId: indicator.id } },
        create: {
          releaseId: release.id,
          indicatorId: indicator.id,
          observationPeriod: targetPeriod,
          actualInitial: new Prisma.Decimal(candidate.value),
          previousAtRelease: previousAtRelease?.value ?? null,
          revisedPreviousAtRelease: revisedPrevious ? new Prisma.Decimal(revisedPrevious) : null,
          consensusAtRelease: null,
          consensusProvider: null,
          consensusAsOf: null,
          fetchedAt: candidate.fetchedAt,
        },
        update: {},
      });
      return { captured: true, provider: source.provider, errors };
    } catch (error) {
      const code = error instanceof MacroProviderError ? error.code : error instanceof Error ? error.name : "UNKNOWN";
      errors.push({ provider: source.provider, code });
      console.error(JSON.stringify({ event: "macro.release.poll.failed", releaseKey: release.releaseKey, indicator: canonicalKey, provider: source.provider, code, message: String(error).slice(0, 500) }));
    }
  }
  return { captured: false, provider: null, errors };
}

async function markAttempt(release: ReleaseRow, status: string, now: Date, error: string | null = null) {
  await prisma.macroSyncState.upsert({
    where: { provider_scopeKey: { provider: "release-watcher", scopeKey: release.id } },
    create: { provider: "release-watcher", scopeKey: release.id, lastAttemptAt: now, lastStatus: status, lastError: error },
    update: { lastAttemptAt: now, lastStatus: status, lastError: error, ...(status === "released" ? { lastSuccessAt: now } : {}) },
  });
}

async function watchRelease(release: ReleaseRow, now: Date) {
  const family = getMacroReleaseFamily(release.releaseFamily);
  if (!family) throw new Error(`Unknown release family ${release.releaseFamily}.`);
  const schedule = watchSchedule(release.scheduledAt, now, family);
  if (schedule.phase === "outside") return { status: "outside" as const, attempted: false };
  if (schedule.phase === "expired") {
    await prisma.macroRelease.update({ where: { id: release.id }, data: { status: "FAILED" } });
    await markAttempt(release, "expired", now, "Release data did not arrive inside the configured retry window.");
    return { status: "expired" as const, attempted: false };
  }
  const state = await prisma.macroSyncState.findUnique({
    where: { provider_scopeKey: { provider: "release-watcher", scopeKey: release.id } },
    select: { lastAttemptAt: true },
  });
  if (state?.lastAttemptAt && schedule.intervalSeconds
    && now.getTime() - state.lastAttemptAt.getTime() < schedule.intervalSeconds * 1000) {
    return { status: "not_due" as const, attempted: false };
  }
  await markAttempt(release, "running", now);
  const targetPeriod = releaseTargetPeriod(release.releaseFamily, release.scheduledAt, release.sourceTimezone, release.externalReleaseId);
  const results = [];
  for (const canonicalKey of family.indicators) results.push(await pollIndicator(release, canonicalKey, targetPeriod, now));
  const captured = await prisma.macroReleaseValue.count({ where: { releaseId: release.id } });
  const complete = captured === family.indicators.length;
  if (complete) {
    await prisma.macroRelease.update({ where: { id: release.id }, data: { status: "RELEASED", releasedAt: release.releasedAt ?? now } });
    await markAttempt(release, "released", now);
    // Freeze only evidence captured before the scheduled release, then calculate the
    // surprise from that immutable snapshot. Neither AI nor post-release data may fill it.
    await freezeReleaseExpectations(release.id);
    await recomputeReleaseSurprises(release.id);
    // The print has just landed and its value is final for this vintage, so generate the
    // bilingual read-out right here — once. This is the release's known moment, and a
    // RELEASED release drops out of the query in watchMacroReleases, so this fires exactly
    // once per release, not once per poll. The model call is isolated so a failure can
    // never take down official-data polling; an operator can regenerate a missed read-out
    // with `macro:forecasts -- --analyze`.
    try {
      await generateReleaseAnalysis(release.id);
    } catch (error) {
      console.error(JSON.stringify({ event: "macro.release.analysis.inline.failed", releaseKey: release.releaseKey, error: String(error).slice(0, 500) }));
    }
  } else {
    const errors = results.flatMap((result) => result.errors);
    await prisma.macroRelease.update({ where: { id: release.id }, data: { status: now >= release.scheduledAt ? "WAITING" : "SCHEDULED" } });
    await markAttempt(release, errors.length ? "error" : "waiting", now, errors.length ? JSON.stringify(errors) : null);
  }
  console.log(JSON.stringify({ event: "macro.release.watch", releaseKey: release.releaseKey, phase: schedule.phase, status: complete ? "released" : "waiting", captured, expected: family.indicators.length }));
  return { status: complete ? "released" as const : "waiting" as const, attempted: true };
}

export async function watchMacroReleases(now = new Date(), releaseId?: string) {
  await syncMacroRegistry();
  const releases = await prisma.macroRelease.findMany({
    where: {
      ...(releaseId ? { id: releaseId } : { scheduledAt: { gte: new Date(now.getTime() - 86_400_000), lte: new Date(now.getTime() + 31 * 60_000) } }),
      status: { in: ["SCHEDULED", "WAITING", "DELAYED", "FAILED"] },
    },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, releaseKey: true, releaseFamily: true, scheduledAt: true, sourceTimezone: true, externalReleaseId: true, releasedAt: true },
  });
  const results = [];
  for (const release of releases) results.push(await watchRelease(release, now));
  // The bilingual read-out is generated inside watchRelease, once, at the instant a release
  // is captured — see the RELEASED branch there. Because a RELEASED release leaves the query
  // above, that is one model call per release (its known publish moment), not one per poll,
  // so there is no standing per-poll cost. `macro:forecasts -- --analyze` stays available as
  // a manual repair path for a read-out whose one-shot generation failed.
  return {
    considered: releases.length,
    attempted: results.filter((result) => result.attempted).length,
    released: results.filter((result) => result.status === "released").length,
    waiting: results.filter((result) => result.status === "waiting").length,
    expired: results.filter((result) => result.status === "expired").length,
  };
}
