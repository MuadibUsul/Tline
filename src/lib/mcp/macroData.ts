import { prisma } from "../db";
import { getMacroIndicator, getMacroSources } from "../macro/registry";
import { authorizedExpectationIds } from "../macro/expectationUse";
import { localePath, type Locale } from "../i18n";
import { siteUrl } from "../site";

/**
 * Macro data shaped for MCP consumers: strings for numbers (a JSON number cannot carry the
 * publisher's decimal precision), ISO dates, an explicit `asOf`, the source, and a page URL
 * a model can cite. The site pages render the same rows; this is a projection of them, not
 * a second source of truth, so the two cannot disagree about what an indicator is.
 */

const ISO_DAY = 86_400_000;

export interface IndicatorPoint {
  period: string;
  value: string;
  source: string;
}

export interface IndicatorPayload {
  key: string;
  name: string;
  countryCode: string;
  currency: string | null;
  category: string;
  frequency: string;
  unit: string;
  seasonalAdjustment: string | null;
  importance: number;
  points: IndicatorPoint[];
  sources: Array<{ provider: string; seriesId: string; url: string | null }>;
  asOf: string | null;
  pageUrl: string;
}

export type MacroDataResult<T> = { ok: true; data: T } | { ok: false; code: "NOT_FOUND" | "INVALID_RANGE"; message: string };

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * The latest vintage per period, across sources, newest periods first — the same merge the
 * indicator page performs, bounded by `limit` periods instead of a fixed window. Sources
 * are visited by priority, and the first row a period is seen in is its latest vintage
 * because the observations arrive ordered by (period desc, vintageAt desc).
 */
export async function readMacroIndicator(canonicalKey: string, options: { from?: Date; to?: Date; limit: number; locale: Locale }): Promise<MacroDataResult<IndicatorPayload>> {
  const definition = getMacroIndicator(canonicalKey);
  if (!definition) return { ok: false, code: "NOT_FOUND", message: `Unknown macro indicator '${canonicalKey}'.` };
  const from = options.from;
  const to = options.to;
  if (from && to && from.getTime() > to.getTime()) return { ok: false, code: "INVALID_RANGE", message: "'from' must not be later than 'to'." };

  const row = await prisma.macroIndicator.findUnique({
    where: { canonicalKey },
    include: {
      seriesSources: {
        where: { enabled: true },
        orderBy: { priority: "asc" },
        include: {
          observations: {
            where: { ...(from || to ? { period: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
            orderBy: [{ period: "desc" }, { vintageAt: "desc" }],
            take: options.limit,
          },
        },
      },
    },
  });
  // No database row means nothing has ever been ingested for this indicator yet; the
  // registry knows the definition, so the answer is an empty series, not an error.
  const sources = row?.seriesSources ?? [];

  const byPeriod = new Map<number, IndicatorPoint>();
  let asOf: Date | null = null;
  for (const source of sources) {
    for (const observation of source.observations) {
      if (observation.fetchedAt > (asOf ?? new Date(0))) asOf = observation.fetchedAt;
      const key = observation.period.getTime();
      if (!byPeriod.has(key)) byPeriod.set(key, { period: observation.period.toISOString(), value: observation.value.toString(), source: source.provider });
    }
  }
  const points = [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period)).slice(0, options.limit);

  return {
    ok: true,
    data: {
      key: definition.canonicalKey,
      name: options.locale === "zh-CN" ? definition.nameZh ?? definition.nameEn : definition.nameEn,
      countryCode: definition.countryCode,
      currency: definition.currency,
      category: definition.category,
      frequency: definition.frequency,
      unit: definition.unit,
      seasonalAdjustment: definition.seasonalAdjustment,
      importance: definition.importance,
      points,
      sources: getMacroSources(canonicalKey).map((source) => ({ provider: source.provider, seriesId: source.externalSeriesId, url: source.sourceUrl ?? null })),
      asOf: iso(asOf),
      pageUrl: `${siteUrl()}${localePath(options.locale, `/macro/indicator/${definition.canonicalKey}`)}`,
    },
  };
}

export interface CalendarValue {
  indicator: { key: string; name: string };
  period: string;
  previous: string | null;
  revisedPrevious: string | null;
  consensus: string | null;
  actual: string | null;
}

export interface CalendarEntry {
  id: string;
  title: string;
  countryCode: string;
  currency: string | null;
  agency: string;
  importance: number;
  status: string;
  scheduledAt: string;
  releasedAt: string | null;
  values: CalendarValue[];
  pageUrl: string;
}

export async function readMacroCalendar(options: {
  from: Date;
  to: Date;
  countryCode?: string;
  importance?: number;
  limit: number;
  locale: Locale;
}): Promise<MacroDataResult<{ from: string; to: string; entries: CalendarEntry[]; asOf: string }>> {
  const { from, to, locale } = options;
  if (from.getTime() > to.getTime()) return { ok: false, code: "INVALID_RANGE", message: "'from' must not be later than 'to'." };
  if (to.getTime() - from.getTime() > 366 * ISO_DAY) return { ok: false, code: "INVALID_RANGE", message: "The calendar window is limited to 366 days." };

  const releases = await prisma.macroRelease.findMany({
    where: {
      scheduledAt: { gte: from, lte: to },
      ...(options.countryCode ? { countryCode: options.countryCode.toUpperCase() } : {}),
      ...(options.importance ? { importance: { gte: options.importance } } : {}),
    },
    orderBy: { scheduledAt: "asc" },
    take: options.limit,
    include: {
      values: { include: { indicator: true, consensusExpectation: { select: { id: true, licenseKey: true } } } },
    },
  });

  // Consensus is survey data under a licence. The social pipeline already gates it by use
  // surface; MCP is a machine-consumer surface like the API, so it asks the same question
  // with the "api" use. An unauthorised expectation is withheld, never guessed around.
  const expectations = releases.flatMap((release) => release.values.flatMap((value) => (value.consensusExpectation ? [value.consensusExpectation] : [])));
  const authorized = await authorizedExpectationIds(expectations, "api");

  return {
    ok: true,
    data: {
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: new Date().toISOString(),
      entries: releases.map((release) => ({
        id: release.id,
        title: locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn,
        countryCode: release.countryCode,
        currency: release.currency,
        agency: release.agency,
        importance: release.importance,
        status: release.status,
        scheduledAt: release.scheduledAt.toISOString(),
        releasedAt: iso(release.releasedAt),
        values: release.values.map((value) => ({
          indicator: {
            key: value.indicator.canonicalKey,
            name: locale === "zh-CN" ? value.indicator.nameZh ?? value.indicator.nameEn : value.indicator.nameEn,
          },
          period: value.observationPeriod.toISOString(),
          previous: value.previousAtRelease?.toString() ?? null,
          revisedPrevious: value.revisedPreviousAtRelease?.toString() ?? null,
          consensus: value.consensusExpectation && authorized.has(value.consensusExpectation.id) ? value.consensusAtRelease?.toString() ?? null : null,
          actual: value.actualInitial?.toString() ?? null,
        })),
        pageUrl: `${siteUrl()}${localePath(locale, `/macro/release/${release.id}`)}`,
      })),
    },
  };
}
