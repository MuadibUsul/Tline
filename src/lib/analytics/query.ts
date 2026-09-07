import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { dayKey, dayRange, shiftDay } from "./identity";

/**
 * The dashboard's queries.
 *
 * These read the raw tables rather than the daily rollup. Every range the console offers
 * (24h through 90d) sits inside the raw retention window, so raw is both available and
 * exact — the rollup exists to outlive that window and to make pruning safe, not to
 * answer these. If the corpus grows to where a 90-day scan is slow, the fix is to read
 * `TrafficDaily` for whole days and raw only for today; the shapes returned here are the
 * same either way.
 */

export const RANGES = ["24h", "7d", "30d", "90d"] as const;
export type Range = (typeof RANGES)[number];

export function isRange(value: unknown): value is Range {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

export const RANGE_DAYS: Record<Range, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

export interface Window {
  from: Date;
  to: Date;
  /** The equally long window immediately before, for period-on-period comparison. */
  previousFrom: Date;
  days: number;
}

export function windowFor(range: Range, now: Date = new Date()): Window {
  const days = RANGE_DAYS[range];
  const span = days * 24 * 60 * 60 * 1000;
  return { from: new Date(now.getTime() - span), to: now, previousFrom: new Date(now.getTime() - 2 * span), days };
}

export interface Overview {
  views: number;
  visitors: number;
  sessions: number;
  bounceRate: number | null;
  avgDurationSec: number | null;
  viewsChange: number | null;
  visitorsChange: number | null;
}

function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Distinct values of one column in a time window, counted by the database. */
async function distinct(field: "visitorId" | "sessionId", from: Date, to: Date): Promise<number> {
  const rows = await prisma.pageView.groupBy({ by: [field], where: { ts: { gte: from, lte: to } } });
  return rows.length;
}

export async function overview(window: Window): Promise<Overview> {
  const inWindow: Prisma.PageViewWhereInput = { ts: { gte: window.from, lte: window.to } };
  const [views, visitors, sessions, sessionSizes, duration, previousViews, previousVisitors] = await Promise.all([
    prisma.pageView.count({ where: inWindow }),
    distinct("visitorId", window.from, window.to),
    distinct("sessionId", window.from, window.to),
    // A bounce is a session that produced exactly one view: the reader arrived and left
    // without going anywhere else.
    prisma.pageView.groupBy({ by: ["sessionId"], where: inWindow, _count: { _all: true } }),
    prisma.pageView.aggregate({ where: { ...inWindow, durationMs: { not: null } }, _avg: { durationMs: true } }),
    prisma.pageView.count({ where: { ts: { gte: window.previousFrom, lt: window.from } } }),
    prisma.pageView.groupBy({ by: ["visitorId"], where: { ts: { gte: window.previousFrom, lt: window.from } } }),
  ]);

  const bounces = sessionSizes.filter((row) => row._count._all === 1).length;
  return {
    views,
    visitors,
    sessions,
    bounceRate: sessions === 0 ? null : (bounces / sessions) * 100,
    avgDurationSec: duration._avg.durationMs === null ? null : duration._avg.durationMs / 1000,
    viewsChange: change(views, previousViews),
    visitorsChange: change(visitors, previousVisitors.length),
  };
}

export interface SeriesPoint {
  label: string;
  primary: number;
  secondary: number;
}

/**
 * Views and visitors over the window: by hour for a day, by calendar day beyond that.
 *
 * Bucketing happens here rather than in SQL because the two databases spell date
 * truncation differently, and one schema serves both.
 */
export async function timeseries(window: Window, now: Date = new Date()): Promise<SeriesPoint[]> {
  if (window.days === 1) {
    const rows = await prisma.pageView.findMany({
      where: { ts: { gte: window.from, lte: window.to } },
      select: { ts: true, visitorId: true },
    });
    const buckets = Array.from({ length: 24 }, (_, index) => {
      const hour = new Date(now.getTime() - (23 - index) * 60 * 60 * 1000);
      hour.setUTCMinutes(0, 0, 0);
      return { at: hour, label: `${String(hour.getUTCHours()).padStart(2, "0")}:00`, views: 0, visitors: new Set<string>() };
    });
    for (const row of rows) {
      const index = buckets.findIndex((bucket, position) =>
        row.ts >= bucket.at && (position === buckets.length - 1 || row.ts < buckets[position + 1].at));
      if (index < 0) continue;
      buckets[index].views += 1;
      buckets[index].visitors.add(row.visitorId);
    }
    return buckets.map((bucket) => ({ label: bucket.label, primary: bucket.views, secondary: bucket.visitors.size }));
  }

  const days = dayRange(window.days, now);
  // One row per (day, visitor): views come from the count, visitors from the row count,
  // so a single grouped query answers both series.
  const rows = await prisma.pageView.groupBy({
    by: ["day", "visitorId"],
    where: { day: { gte: days[0] } },
    _count: { _all: true },
  });
  const byDay = new Map(days.map((day) => [day, { views: 0, visitors: 0 }]));
  for (const row of rows) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    bucket.views += row._count._all;
    bucket.visitors += 1;
  }
  return days.map((day) => ({
    label: day.slice(5), // MM-DD; the year is the same across every range offered
    primary: byDay.get(day)!.views,
    secondary: byDay.get(day)!.visitors,
  }));
}

export type Dimension = "path" | "referrerHost" | "country" | "device" | "browser" | "os" | "locale" | "utmSource" | "utmMedium" | "utmCampaign";

export interface BreakdownRow {
  value: string;
  views: number;
  visitors: number;
}

/** The columns that can be null; the rest are required and reject a null comparison. */
const NULLABLE: ReadonlySet<Dimension> = new Set(["referrerHost", "country", "utmSource", "utmMedium", "utmCampaign"]);

/** Top values of one dimension, ranked by views, with the visitor count beside each. */
export async function breakdown(dimension: Dimension, window: Window, limit = 10): Promise<BreakdownRow[]> {
  const rows = await prisma.pageView.groupBy({
    by: [dimension, "visitorId"],
    where: {
      ts: { gte: window.from, lte: window.to },
      ...(NULLABLE.has(dimension) ? { NOT: { [dimension]: null } } : {}),
    },
    _count: { _all: true },
  });
  const totals = new Map<string, { views: number; visitors: number }>();
  for (const row of rows) {
    const key = (row as Record<string, unknown>)[dimension];
    if (typeof key !== "string" || !key) continue;
    const bucket = totals.get(key) ?? { views: 0, visitors: 0 };
    bucket.views += row._count._all;
    bucket.visitors += 1;
    totals.set(key, bucket);
  }
  return [...totals.entries()]
    .map(([value, counts]) => ({ value, ...counts }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export interface EventRow {
  name: string;
  count: number;
  visitors: number;
}

export async function events(window: Window, limit = 15): Promise<EventRow[]> {
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["name", "visitorId"],
    where: { ts: { gte: window.from, lte: window.to } },
    _count: { _all: true },
  });
  const totals = new Map<string, { count: number; visitors: number }>();
  for (const row of rows) {
    const bucket = totals.get(row.name) ?? { count: 0, visitors: 0 };
    bucket.count += row._count._all;
    bucket.visitors += 1;
    totals.set(row.name, bucket);
  }
  return [...totals.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface Realtime {
  visitors: number;
  views: number;
  pages: { path: string; views: number }[];
}

/** The last half hour: who is here now, and what they have open. */
export async function realtime(now: Date = new Date()): Promise<Realtime> {
  const from = new Date(now.getTime() - 30 * 60_000);
  const rows = await prisma.pageView.findMany({ where: { ts: { gte: from } }, select: { path: true, visitorId: true } });
  const pages = new Map<string, number>();
  const visitors = new Set<string>();
  for (const row of rows) {
    pages.set(row.path, (pages.get(row.path) ?? 0) + 1);
    visitors.add(row.visitorId);
  }
  return {
    visitors: visitors.size,
    views: rows.length,
    pages: [...pages.entries()].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views).slice(0, 8),
  };
}

export interface VitalSummary {
  metric: string;
  p75: number;
  samples: number;
  rating: "good" | "needs-improvement" | "poor";
}

/** Thresholds are Google's own; p75 is the percentile Core Web Vitals is defined on. */
const VITAL_BOUNDS: Record<string, [number, number]> = {
  LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800],
};

export async function vitals(window: Window): Promise<VitalSummary[]> {
  const rows = await prisma.webVital.findMany({
    where: { ts: { gte: window.from, lte: window.to } },
    select: { metric: true, value: true },
  });
  const grouped = new Map<string, number[]>();
  for (const row of rows) grouped.set(row.metric, [...(grouped.get(row.metric) ?? []), row.value]);

  return [...grouped.entries()].map(([metric, values]) => {
    values.sort((a, b) => a - b);
    const p75 = values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
    const [good, poor] = VITAL_BOUNDS[metric] ?? [Infinity, Infinity];
    return { metric, p75, samples: values.length, rating: p75 <= good ? "good" : p75 <= poor ? "needs-improvement" : "poor" } as VitalSummary;
  }).sort((a, b) => a.metric.localeCompare(b.metric));
}

// ---- Audience: the signed-in side ----

export interface AudienceSummary {
  dau: number;
  wau: number;
  mau: number;
  /** DAU over MAU: how much of the registered audience shows up on a given day. */
  stickiness: number | null;
  signedInViews: number;
  anonymousViews: number;
}

export async function audience(now: Date = new Date()): Promise<AudienceSummary> {
  const since = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const activeUsers = async (days: number) =>
    (await prisma.pageView.groupBy({ by: ["userId"], where: { ts: { gte: since(days) }, NOT: { userId: null } } })).length;

  const [dau, wau, mau, signedInViews, anonymousViews] = await Promise.all([
    activeUsers(1),
    activeUsers(7),
    activeUsers(30),
    prisma.pageView.count({ where: { ts: { gte: since(30) }, NOT: { userId: null } } }),
    prisma.pageView.count({ where: { ts: { gte: since(30) }, userId: null } }),
  ]);
  return { dau, wau, mau, stickiness: mau === 0 ? null : (dau / mau) * 100, signedInViews, anonymousViews };
}

export interface FunnelStep {
  label: string;
  count: number;
}

/**
 * Visitor → account → first watchlist item → first alert rule, over 30 days.
 *
 * The first step counts visitors rather than accounts, so the drop from browsing to
 * signing up is visible; the rest are counted from the account's own records, which are
 * exact and survive the analytics retention window.
 */
export async function funnel(now: Date = new Date()): Promise<FunnelStep[]> {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [visitors, signups, withWatchlist, withRules] = await Promise.all([
    prisma.pageView.groupBy({ by: ["visitorId"], where: { ts: { gte: from } } }),
    prisma.user.count({ where: { createdAt: { gte: from } } }),
    prisma.user.count({ where: { createdAt: { gte: from }, watchlist: { some: {} } } }),
    prisma.user.count({ where: { createdAt: { gte: from }, rules: { some: {} } } }),
  ]);
  return [
    { label: "visitors", count: visitors.length },
    { label: "accounts", count: signups },
    { label: "watchlist", count: withWatchlist },
    { label: "alerts", count: withRules },
  ];
}

export interface RetentionRow {
  cohort: string;
  size: number;
  /** Share of the cohort still returning in week 0..n, as percentages. */
  weeks: (number | null)[];
}

/**
 * Weekly retention: of the people who signed up in a given week, how many came back.
 *
 * Return is measured from page views, so it means "opened the site", not "logged an
 * action" — the weaker and more honest definition of the two.
 */
export async function retention(weeks = 6, now: Date = new Date()): Promise<RetentionRow[]> {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - weeks * weekMs);
  const [users, activity] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: start } }, select: { id: true, createdAt: true } }),
    prisma.pageView.groupBy({ by: ["userId", "day"], where: { ts: { gte: start }, NOT: { userId: null } } }),
  ]);
  if (users.length === 0) return [];

  const seen = new Map<string, string[]>();
  for (const row of activity) {
    if (!row.userId) continue;
    seen.set(row.userId, [...(seen.get(row.userId) ?? []), row.day]);
  }

  const cohorts = new Map<number, { size: number; returned: number[] }>();
  for (const user of users) {
    const index = Math.floor((user.createdAt.getTime() - start.getTime()) / weekMs);
    const cohort = cohorts.get(index) ?? { size: 0, returned: Array.from({ length: weeks }, () => 0) };
    cohort.size += 1;
    const days = seen.get(user.id) ?? [];
    for (let offset = 0; offset + index < weeks; offset++) {
      const weekStart = new Date(start.getTime() + (index + offset) * weekMs);
      const window = Array.from({ length: 7 }, (_, day) => shiftDay(weekStart, day));
      if (days.some((day) => window.includes(day))) cohort.returned[offset] += 1;
    }
    cohorts.set(index, cohort);
  }

  return [...cohorts.entries()].sort((a, b) => a[0] - b[0]).map(([index, cohort]) => ({
    cohort: dayKey(new Date(start.getTime() + index * weekMs)),
    size: cohort.size,
    weeks: cohort.returned.map((count, offset) =>
      offset + index < weeks ? (cohort.size === 0 ? null : (count / cohort.size) * 100) : null),
  }));
}

export interface ActiveUser {
  id: string;
  email: string;
  views: number;
  lastSeenAt: Date | null;
}

/** The accounts reading the most, over 30 days. Links into account management. */
export async function topUsers(limit = 20, now: Date = new Date()): Promise<ActiveUser[]> {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.pageView.groupBy({
    by: ["userId"],
    where: { ts: { gte: from }, NOT: { userId: null } },
    _count: { _all: true },
    orderBy: { _count: { userId: "desc" } },
    take: limit,
  });
  const ids = rows.map((row) => row.userId).filter((id): id is string => id !== null);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, lastSeenAt: true } });
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows
    .map((row) => {
      const user = row.userId ? byId.get(row.userId) : undefined;
      return user ? { id: user.id, email: user.email, views: row._count._all, lastSeenAt: user.lastSeenAt } : null;
    })
    .filter((row): row is ActiveUser => row !== null);
}
