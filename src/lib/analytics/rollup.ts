import { prisma } from "../db";
import { shiftDay } from "./identity";

/**
 * Turning raw rows into daily totals, then deleting the rows.
 *
 * The raw tables are what make an exact count of visitors possible; they are also the
 * only tables here that grow with traffic rather than with time. So they are kept for a
 * window and then dropped, and what survives is one row per day per dimension value.
 * A year-on-year comparison then costs a few thousand rows instead of a few million.
 *
 * Aggregating is idempotent: a day is recomputed from scratch every time, so running it
 * twice, or re-running it after a backfill, produces the same numbers rather than double
 * counting.
 */

/** Every dimension the traffic dashboard breaks down by, and the column it reads. */
const DIMENSIONS = {
  path: "path",
  referrer: "referrerHost",
  country: "country",
  device: "device",
  browser: "browser",
  os: "os",
  locale: "locale",
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
} as const;

interface Bucket {
  dimension: string;
  value: string;
  views: number;
  visitors: Set<string>;
  sessions: Set<string>;
  durationSec: number;
}

export interface RollupResult {
  day: string;
  views: number;
  rows: number;
}

/**
 * A nested map rather than one keyed by a joined string.
 *
 * The values counted here include browser names with spaces and paths with slashes, so
 * any separator picked for a composite key eventually turns up inside a value and splits
 * it in half on the way back out. Nesting removes the question.
 */
class Buckets {
  private readonly byDimension = new Map<string, Map<string, Bucket>>();

  get(dimension: string, value: string): Bucket {
    let group = this.byDimension.get(dimension);
    if (!group) {
      group = new Map();
      this.byDimension.set(dimension, group);
    }
    let bucket = group.get(value);
    if (!bucket) {
      bucket = { dimension, value, views: 0, visitors: new Set(), sessions: new Set(), durationSec: 0 };
      group.set(value, bucket);
    }
    return bucket;
  }

  all(): Bucket[] {
    return [...this.byDimension.values()].flatMap((group) => [...group.values()]);
  }
}

/** Recomputes `TrafficDaily` for one UTC day from the raw rows still present for it. */
export async function rollupDay(day: string): Promise<RollupResult> {
  const views = await prisma.pageView.findMany({
    where: { day },
    select: {
      path: true, referrerHost: true, country: true, device: true, browser: true,
      os: true, locale: true, utmSource: true, utmMedium: true, utmCampaign: true,
      visitorId: true, sessionId: true, durationMs: true,
    },
  });
  const events = await prisma.analyticsEvent.findMany({ where: { day }, select: { name: true, visitorId: true, sessionId: true } });

  const buckets = new Buckets();
  // Sessions are counted once per day, and a bounce is a session with one view; both need
  // the whole day's rows in hand, which is why this runs after the day is complete.
  const sessionViews = new Map<string, number>();

  for (const view of views) {
    const seconds = Math.round((view.durationMs ?? 0) / 1000);
    const total = buckets.get("total", "");
    total.views += 1;
    total.visitors.add(view.visitorId);
    total.sessions.add(view.sessionId);
    total.durationSec += seconds;
    sessionViews.set(view.sessionId, (sessionViews.get(view.sessionId) ?? 0) + 1);

    for (const [dimension, column] of Object.entries(DIMENSIONS)) {
      const value = view[column as keyof typeof view];
      if (typeof value !== "string" || !value) continue;
      const target = buckets.get(dimension, value);
      target.views += 1;
      target.visitors.add(view.visitorId);
      target.sessions.add(view.sessionId);
      target.durationSec += seconds;
    }
  }

  for (const event of events) {
    const target = buckets.get("event", event.name);
    target.views += 1;
    target.visitors.add(event.visitorId);
    target.sessions.add(event.sessionId);
  }

  const bounces = [...sessionViews.values()].filter((count) => count === 1).length;

  const rows = buckets.all().map((counts) => ({
    day,
    dimension: counts.dimension,
    value: counts.value,
    views: counts.views,
    visitors: counts.visitors.size,
    sessions: counts.sessions.size,
    // Only the day's total carries a bounce count: a bounce is a property of a session,
    // and a session that visited three pages belongs to three path rows at once.
    bounces: counts.dimension === "total" ? bounces : 0,
    durationSec: counts.durationSec,
  }));

  // Delete-then-insert inside one transaction is what makes a re-run idempotent: an
  // upsert per row would leave yesterday's values for anything that has since gone to zero.
  await prisma.$transaction([
    prisma.trafficDaily.deleteMany({ where: { day } }),
    ...(rows.length ? [prisma.trafficDaily.createMany({ data: rows })] : []),
  ]);

  return { day, views: views.length, rows: rows.length };
}

export interface PruneResult {
  before: string;
  pageViews: number;
  events: number;
  vitals: number;
}

/** Deletes raw rows older than the retention window. Aggregates are never pruned. */
export async function pruneRaw(retentionDays: number, now: Date = new Date()): Promise<PruneResult> {
  const before = shiftDay(now, -retentionDays);
  const [pageViews, events, vitals] = await prisma.$transaction([
    prisma.pageView.deleteMany({ where: { day: { lt: before } } }),
    prisma.analyticsEvent.deleteMany({ where: { day: { lt: before } } }),
    prisma.webVital.deleteMany({ where: { day: { lt: before } } }),
  ]);
  return { before, pageViews: pageViews.count, events: events.count, vitals: vitals.count };
}

export function retentionDays(): number {
  const value = Number(process.env.ANALYTICS_RAW_RETENTION_DAYS || 90);
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 90;
}

/**
 * The scheduled pass: recompute the last few days, then prune.
 *
 * Several days rather than only yesterday, because a duration beacon can arrive after
 * midnight and a backfill can add rows to a day already summarised — recomputing is cheap
 * and always correct, where an incremental update would silently drift.
 */
export async function rollupRecent(days = 3, now: Date = new Date()) {
  const rolled: RollupResult[] = [];
  for (let offset = 0; offset < days; offset++) {
    rolled.push(await rollupDay(shiftDay(now, -offset)));
  }
  return { rolled, pruned: await pruneRaw(retentionDays(), now) };
}
