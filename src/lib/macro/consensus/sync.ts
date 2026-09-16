import { prisma } from "../../db";
import { licensePermits } from "../market/quality";
import { previousObservationPeriod, releaseTargetPeriod } from "../watch";
import { recordMacroExpectation } from "../expectations";
import { CALENDAR_SOURCE_URL, fetchCalendarEvents, type CalendarEvent } from "./feed";
import { convertToLevel, mappingFor, roundForUnit, type IndicatorMapping } from "./mapping";

/**
 * Record the market consensus for upcoming releases from the public calendar feed.
 *
 * This is the missing half of the expectations design: the schema, the pre-release
 * snapshot, the licence gate and the analysis prompt all existed, and the only writer was
 * an operator CLI, so in practice every release printed without a consensus and the AI
 * read-out could never legitimately say whether a number beat or missed. Here the
 * consensus is captured before the release, which is the only moment it is still a
 * forecast — after the print the same number is hindsight.
 */
export const CALENDAR_DATASET = "forexfactory:calendar";

/** The feed rounds its timestamps to the minute; the official calendars ours come from can differ by a few. */
const MATCH_TOLERANCE_MS = 45 * 60_000;

export interface ConsensusSyncResult {
  events: number;
  matched: number;
  recorded: number;
  unchanged: number;
  skipped: number;
  rejected: string[];
  licenseAuthorized: boolean;
}

/**
 * The level the forecast is stated against.
 *
 * The immediately preceding period is the right one — a weekly change from last week, a
 * month-on-month change from last month. When that period is missing from every source
 * (the API a week behind, a series that starts mid-year) the latest earlier vintage is
 * used instead, because a consensus derived from a stale level still beats no consensus —
 * but it is named in the provenance so the reader can see which level it came from.
 */
async function previousLevel(canonicalKey: string, period: Date, before: Date) {
  const exact = await prisma.macroObservation.findFirst({
    where: { period, fetchedAt: { lt: before }, seriesSource: { enabled: true, indicator: { canonicalKey } } },
    orderBy: [{ vintageAt: "desc" }, { revisionNo: "desc" }],
    select: { value: true, period: true, seriesSource: { select: { provider: true } } },
  });
  if (exact) return { value: Number(exact.value.toString()), period: exact.period, provider: exact.seriesSource.provider };
  const earlier = await prisma.macroObservation.findFirst({
    where: { period: { lt: period }, fetchedAt: { lt: before }, seriesSource: { enabled: true, indicator: { canonicalKey } } },
    orderBy: [{ period: "desc" }, { vintageAt: "desc" }, { revisionNo: "desc" }],
    select: { value: true, period: true, seriesSource: { select: { provider: true } } },
  });
  return earlier ? { value: Number(earlier.value.toString()), period: earlier.period, provider: earlier.seriesSource.provider } : null;
}

interface Recorded {
  releaseId: string;
  indicatorId: string;
  value: string;
  source: string;
}

/** Re-recording the same forecast every half hour would append a revision each time. */
async function alreadyRecorded(releaseId: string, indicatorId: string, value: string) {
  const latest = await prisma.macroExpectation.findFirst({
    where: { releaseId, indicatorId, type: "SURVEY_CONSENSUS", source: "forexfactory" },
    orderBy: { revisionNo: "desc" },
    select: { value: true },
  });
  return Boolean(latest && Number(latest.value.toString()) === Number(value));
}

async function recordOne(input: {
  releaseId: string; indicatorId: string; referencePeriod: Date; value: number; unit: string;
  seasonalAdjustment: string | null; event: CalendarEvent; mapping: IndicatorMapping; derived: string;
  capturedAt: Date; historical: boolean;
}) {
  const value = String(roundForUnit(input.value, input.unit));
  return recordMacroExpectation({
    releaseId: input.releaseId,
    indicatorId: input.indicatorId,
    referencePeriod: input.referencePeriod,
    type: "SURVEY_CONSENSUS",
    source: "forexfactory",
    sourceEventId: `${input.event.title}@${input.event.at.toISOString()}`,
    rawField: `forecast=${input.event.forecastRaw || "n/a"}; feed previous=${input.event.previousRaw || "n/a"}; ${input.derived}`,
    sourceUrl: CALENDAR_SOURCE_URL,
    licenseKey: CALENDAR_DATASET,
    value,
    unit: input.unit,
    seasonalAdjustment: input.seasonalAdjustment,
    capturedAt: input.capturedAt,
    entryMethod: "SYNC",
    historicalReconstruction: input.historical,
  });
}

export async function syncConsensusExpectations(now = new Date(), options: { fetch?: typeof fetch } = {}): Promise<ConsensusSyncResult> {
  const events = (await fetchCalendarEvents(options.fetch ? { fetch: options.fetch } : {})).filter((event) => event.country === "USD" && event.forecast !== null);
  const result: ConsensusSyncResult = { events: events.length, matched: 0, recorded: 0, unchanged: 0, skipped: 0, rejected: [], licenseAuthorized: false };

  const policy = await prisma.dataLicensePolicy.findUnique({ where: { datasetKey: CALENDAR_DATASET } });
  result.licenseAuthorized = licensePermits(policy, "internal_analysis");
  if (!result.licenseAuthorized) {
    // The rows would be written and then ignored by every reader, which looks like a
    // working sync and behaves like a silent one. Say so instead.
    console.warn(JSON.stringify({ event: "macro.consensus.license.missing", dataset: CALENDAR_DATASET, status: policy?.status ?? "absent" }));
  }

  const releases = await prisma.macroRelease.findMany({
    where: { scheduledAt: { gte: new Date(now.getTime() - 3 * 3600_000), lte: new Date(now.getTime() + 8 * 86_400_000) } },
    select: { id: true, releaseFamily: true, scheduledAt: true, sourceTimezone: true, externalReleaseId: true, status: true },
    orderBy: { scheduledAt: "asc" },
  });
  const familyIndicators = new Map<string, string[]>();
  for (const family of new Set(releases.map((release) => release.releaseFamily))) {
    const indicators = (await import("../registry")).getMacroReleaseFamily(family)?.indicators ?? [];
    familyIndicators.set(family, indicators);
  }

  for (const release of releases) {
    const indicators = familyIndicators.get(release.releaseFamily) ?? [];
    for (const event of events) {
      const mapping = mappingFor(event.title);
      if (!mapping || !indicators.includes(mapping.canonicalKey)) continue;
      if (Math.abs(event.at.getTime() - release.scheduledAt.getTime()) > MATCH_TOLERANCE_MS) continue;
      result.matched++;
      const indicator = await prisma.macroIndicator.findUnique({ where: { canonicalKey: mapping.canonicalKey }, select: { id: true, unit: true, seasonalAdjustment: true } });
      if (!indicator) { result.skipped++; continue; }
      const targetPeriod = releaseTargetPeriod(release.releaseFamily, release.scheduledAt, release.sourceTimezone, release.externalReleaseId);
      const previous = await previousLevel(mapping.canonicalKey, previousObservationPeriod(targetPeriod, release.releaseFamily) ?? targetPeriod, release.scheduledAt);
      const converted = convertToLevel(mapping, event, previous?.value ?? null);
      if ("error" in converted) {
        result.rejected.push(`${event.title} ${event.forecastRaw}: ${converted.error}`);
        continue;
      }
      const level = String(roundForUnit(converted.value, indicator.unit));
      if (await alreadyRecorded(release.id, indicator.id, level)) { result.unchanged++; continue; }
      // A print that has already landed cannot take a live snapshot: recording it now
      // would dress hindsight up as a forecast.
      const historical = now > release.scheduledAt;
      await recordOne({ releaseId: release.id, indicatorId: indicator.id, referencePeriod: targetPeriod, value: converted.value, unit: indicator.unit, seasonalAdjustment: indicator.seasonalAdjustment, event, mapping, derived: `${converted.derived}${previous ? ` (source ${previous.provider}, period ${previous.period.toISOString().slice(0, 10)})` : ""}`, capturedAt: now, historical });
      result.recorded++;

      if (mapping.companion) {
        const companion = await prisma.macroIndicator.findUnique({ where: { canonicalKey: mapping.companion.canonicalKey }, select: { id: true, unit: true, seasonalAdjustment: true } });
        if (!companion) continue;
        const previousCompanion = await previousLevel(mapping.companion.canonicalKey, previousObservationPeriod(targetPeriod, release.releaseFamily) ?? targetPeriod, release.scheduledAt);
        if (!previous || !previousCompanion) { result.rejected.push(`${event.title}: companion left unset (no pre-release range)`); continue; }
        // The range width is a convention, not a forecast: carry whatever width was in
        // force before the release rather than assuming one.
        const width = previous.value - previousCompanion.value;
        const companionLevel = String(roundForUnit(converted.value - width, companion.unit));
        if (await alreadyRecorded(release.id, companion.id, companionLevel)) { result.unchanged++; continue; }
        await recordOne({ releaseId: release.id, indicatorId: companion.id, referencePeriod: targetPeriod, value: converted.value - width, unit: companion.unit, seasonalAdjustment: companion.seasonalAdjustment, event, mapping, derived: `${converted.derived} less the pre-release range width ${width}`, capturedAt: now, historical });
        result.recorded++;
      }
    }
  }
  return result;
}
