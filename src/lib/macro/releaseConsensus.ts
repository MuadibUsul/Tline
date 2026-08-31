import { prisma } from "../db";
import { getMacroReleaseFamily } from "./registry";
import { releaseTargetPeriod } from "./watch";
import { aggregateForecasts, type ForecastConsensus } from "./forecasts";

type ReleaseKey = { releaseFamily: string; scheduledAt: Date; sourceTimezone: string; externalReleaseId: string | null };

/** Our institutional consensus for a release: aggregate the mined bank forecasts for its
 * primary indicator at the release's target period. Null when no forecasts were mined. */
export async function getReleaseConsensus(release: ReleaseKey): Promise<ForecastConsensus | null> {
  const family = getMacroReleaseFamily(release.releaseFamily);
  if (!family?.indicators.length) return null;
  const indicatorKey = family.indicators[0];
  let referencePeriod: Date;
  try {
    referencePeriod = releaseTargetPeriod(release.releaseFamily, release.scheduledAt, release.sourceTimezone, release.externalReleaseId);
  } catch {
    return null;
  }
  const rows = await prisma.macroForecast.findMany({
    where: { indicatorKey, referencePeriod },
    include: { institution: { select: { name: true } } },
  });
  if (!rows.length) return null;
  return aggregateForecasts(rows.map((row) => ({ institution: row.institution.name, value: row.value, unit: row.unit ?? undefined })));
}

/** Batch version: one query for many releases (used by list views). */
export async function getReleaseConsensusMap(releases: Array<ReleaseKey & { id: string }>): Promise<Map<string, ForecastConsensus>> {
  const keyed = releases.flatMap((release) => {
    const family = getMacroReleaseFamily(release.releaseFamily);
    if (!family?.indicators.length) return [];
    try {
      const referencePeriod = releaseTargetPeriod(release.releaseFamily, release.scheduledAt, release.sourceTimezone, release.externalReleaseId);
      return [{ id: release.id, indicatorKey: family.indicators[0], referencePeriod }];
    } catch {
      return [];
    }
  });
  if (!keyed.length) return new Map();
  const rows = await prisma.macroForecast.findMany({
    where: { OR: keyed.map((k) => ({ indicatorKey: k.indicatorKey, referencePeriod: k.referencePeriod })) },
    include: { institution: { select: { name: true } } },
  });
  const byBucket = new Map<string, Array<{ institution: string; value: number; unit?: string }>>();
  for (const row of rows) {
    const bucket = `${row.indicatorKey}@${row.referencePeriod.getTime()}`;
    (byBucket.get(bucket) ?? byBucket.set(bucket, []).get(bucket)!).push({ institution: row.institution.name, value: row.value, unit: row.unit ?? undefined });
  }
  const result = new Map<string, ForecastConsensus>();
  for (const key of keyed) {
    const items = byBucket.get(`${key.indicatorKey}@${key.referencePeriod.getTime()}`);
    if (items?.length) result.set(key.id, aggregateForecasts(items));
  }
  return result;
}
