import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { macroIndicators, macroSources } from "./registry";

export type AuditSeverity = "info" | "warning" | "severe";
export interface AuditIssue { code: string; severity: AuditSeverity; message: string; entityType: string; entityId: string; details?: Record<string, unknown> }
export interface MacroAuditReport { generatedAt: string; summary: { observations: number; releases: number; sources: number; issues: number; severe: number; warning: number; info: number }; issues: AuditIssue[] }

export function periodMatchesFrequency(period: Date, frequency: string): boolean {
  if (["DAILY", "WEEKLY", "EVENT"].includes(frequency)) return true;
  if (period.getUTCDate() !== 1) return false;
  if (frequency === "MONTHLY") return true;
  if (frequency === "QUARTERLY") return period.getUTCMonth() % 3 === 0;
  if (frequency === "ANNUAL") return period.getUTCMonth() === 0;
  return false;
}

export function valuesMateriallyDisagree(values: Prisma.Decimal[], tolerance = new Prisma.Decimal("0.1")): boolean {
  return values.length > 1 && Prisma.Decimal.max(...values).minus(Prisma.Decimal.min(...values)).abs().greaterThan(tolerance);
}

const staleDays: Record<string, number> = { DAILY: 10, WEEKLY: 28, MONTHLY: 75, QUARTERLY: 180, ANNUAL: 550, EVENT: 550 };
const knownProviders = new Set(["bls", "bea", "fred", "eia", "eurostat", "ecb"]);

export async function auditMacroData(now = new Date()): Promise<MacroAuditReport> {
  const [sources, observations, releases, releaseValues] = await Promise.all([
    prisma.macroSeriesSource.findMany({ where: { enabled: true }, include: { indicator: true } }),
    prisma.macroObservation.findMany({ include: { seriesSource: { include: { indicator: true } } }, orderBy: [{ seriesSourceId: "asc" }, { period: "asc" }, { revisionNo: "asc" }] }),
    prisma.macroRelease.findMany(),
    prisma.macroReleaseValue.findMany({ include: { release: true, indicator: { include: { seriesSources: { orderBy: { priority: "asc" } } } } } }),
  ]);
  const issues: AuditIssue[] = [];
  const add = (code: string, severity: AuditSeverity, message: string, entityType: string, entityId: string, details?: Record<string, unknown>) => issues.push({ code, severity, message, entityType, entityId, ...(details ? { details } : {}) });
  const sourceRegistry = new Map(macroSources.map((source) => [`${source.provider}:${source.externalSeriesId}`, source]));
  const indicatorRegistry = new Map(macroIndicators.map((indicator) => [indicator.canonicalKey, indicator]));

  for (const source of sources) {
    const registry = sourceRegistry.get(`${source.provider}:${source.externalSeriesId}`);
    if (!knownProviders.has(source.provider)) add("UNKNOWN_PROVIDER", "severe", `Unknown provider ${source.provider}.`, "series_source", source.id);
    if (!registry || registry.canonicalKey !== source.indicator.canonicalKey) add("CANONICAL_MAPPING", "severe", "Stored source is missing or disagrees with the canonical registry.", "series_source", source.id);
    if (!source.sourceUrl) add("MISSING_SOURCE_URL", "warning", "Series source has no provenance URL.", "series_source", source.id);
    if (!source.indicator.unit) add("MISSING_UNIT", "severe", "Indicator unit is empty.", "indicator", source.indicator.id);
    const latest = observations.filter((item) => item.seriesSourceId === source.id).at(-1);
    if (!latest) add("EMPTY_SOURCE", "warning", "Enabled source has no observations.", "series_source", source.id);
    else if (now.getTime() - latest.fetchedAt.getTime() > (staleDays[source.indicator.frequency] ?? 180) * 86_400_000) add("STALE_SOURCE", "warning", "Source freshness exceeds its frequency threshold.", "series_source", source.id, { latestFetchedAt: latest.fetchedAt.toISOString(), frequency: source.indicator.frequency });
  }
  for (const indicator of macroIndicators) if (!sources.some((source) => source.indicator.canonicalKey === indicator.canonicalKey)) add("MISSING_CANONICAL_SOURCE", "severe", "Canonical indicator has no materialized source.", "indicator", indicator.canonicalKey);

  const exactKeys = new Set<string>();
  const histories = new Map<string, typeof observations>();
  for (const observation of observations) {
    const exact = `${observation.seriesSourceId}|${observation.period.toISOString()}|${observation.vintageAt.toISOString()}`;
    if (exactKeys.has(exact)) add("DUPLICATE_OBSERVATION", "severe", "Duplicate source/period/vintage observation.", "observation", observation.id);
    exactKeys.add(exact);
    try { new Prisma.Decimal(observation.value); } catch { add("MALFORMED_DECIMAL", "severe", "Observation value is not decimal-safe.", "observation", observation.id); }
    if (observation.vintageAt.getTime() > observation.fetchedAt.getTime() + 86_400_000 || observation.sourcePublishedAt && observation.sourcePublishedAt.getTime() > observation.fetchedAt.getTime() + 86_400_000) add("IMPOSSIBLE_TIMESTAMP", "severe", "Published/vintage timestamp is later than fetch time.", "observation", observation.id);
    if (!periodMatchesFrequency(observation.period, observation.seriesSource.indicator.frequency)) add("FREQUENCY_MISMATCH", "warning", "Observation period is not aligned with indicator frequency.", "observation", observation.id, { frequency: observation.seriesSource.indicator.frequency, period: observation.period.toISOString() });
    if (!observation.rawHash) add("MISSING_RAW_HASH", "warning", "Observation has no raw provenance hash.", "observation", observation.id);
    const key = `${observation.seriesSourceId}|${observation.period.toISOString()}`;
    histories.set(key, [...(histories.get(key) ?? []), observation]);
  }
  for (const [key, history] of histories) {
    const ordered = [...history].sort((a, b) => a.revisionNo - b.revisionNo);
    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index].revisionNo !== ordered[index - 1].revisionNo + 1 || ordered[index].vintageAt < ordered[index - 1].vintageAt) add("VINTAGE_REGRESSION", "severe", "Revision numbers or vintage timestamps regress.", "observation_history", key);
    }
  }

  for (const value of releaseValues) {
    const primaryIds = value.indicator.seriesSources.map((source) => source.id);
    const initial = observations.find((item) => primaryIds.includes(item.seriesSourceId) && item.period.getTime() === value.observationPeriod.getTime() && item.isInitial);
    if (value.actualInitial !== null && initial && value.actualInitial.comparedTo(initial.value) !== 0) add("RELEASE_ACTUAL_MISMATCH", "severe", "Release actual differs from the stored initial observation.", "release_value", value.id, { observationId: initial.id });
    if (value.previousAtRelease !== null) {
      const eligible = observations.some((item) => primaryIds.includes(item.seriesSourceId) && item.period < value.observationPeriod && item.value.comparedTo(value.previousAtRelease!) === 0 && item.fetchedAt <= value.release.scheduledAt && item.vintageAt <= value.release.scheduledAt);
      if (!eligible) add("PREVIOUS_LOOKAHEAD", "severe", "previousAtRelease cannot be supported by a vintage available at release time.", "release_value", value.id);
    }
  }

  for (const indicator of indicatorRegistry.values()) {
    const providerSources = sources.filter((source) => source.indicator.canonicalKey === indicator.canonicalKey && ["bls", "bea", "fred"].includes(source.provider));
    if (!providerSources.some((source) => source.provider === "fred") || !providerSources.some((source) => source.provider === "bls" || source.provider === "bea")) continue;
    const latestByProvider = providerSources.map((source) => observations.filter((item) => item.seriesSourceId === source.id).sort((a, b) => b.period.getTime() - a.period.getTime() || b.revisionNo - a.revisionNo)[0]).filter(Boolean);
    const periods = new Set(latestByProvider.map((item) => item.period.toISOString()));
    if (periods.size === 1 && valuesMateriallyDisagree(latestByProvider.map((item) => item.value))) add("CROSS_PROVIDER_DISAGREEMENT", "warning", "Primary agency and FRED disagree for the latest common period; no value was overwritten.", "indicator", indicator.canonicalKey, { observations: latestByProvider.map((item) => ({ id: item.id, provider: item.seriesSource.provider, value: item.value.toString() })) });
  }

  const counts = (severity: AuditSeverity) => issues.filter((issue) => issue.severity === severity).length;
  return { generatedAt: now.toISOString(), summary: { observations: observations.length, releases: releases.length, sources: sources.length, issues: issues.length, severe: counts("severe"), warning: counts("warning"), info: counts("info") }, issues };
}
