import { prisma } from "./db";
import { dayKey, shiftDay } from "./analytics/identity";

/**
 * API usage, counted as it happens.
 *
 * There is no request log. One row per call would be the largest table in this database
 * and would answer nothing the daily aggregate does not — who called, which endpoint,
 * which status, how long it took. So each request folds into a (day, key, endpoint,
 * status) counter instead.
 *
 * Those counters are buffered in memory and flushed on a timer rather than written per
 * request: an upsert on every call would put a database round trip on the response path
 * of an endpoint whose whole promise is that it is fast. A crash loses at most one flush
 * window of counts, which is the right thing to trade for that.
 */

const FLUSH_MS = Number(process.env.API_USAGE_FLUSH_MS || 10_000);
const MAX_PENDING = 500;

interface Pending {
  day: string;
  /** Empty string for an unauthenticated call; see the note on the model. */
  keyId: string;
  endpoint: string;
  status: number;
  count: number;
  totalMs: number;
}

const pending = new Map<string, Pending>();
let timer: NodeJS.Timeout | null = null;

/**
 * The endpoint, with identifiers folded out.
 *
 * `/api/v1/research/abc123` and `/api/v1/research/def456` are the same endpoint; keeping
 * them apart would turn the breakdown into a list of every report ever fetched.
 */
export function endpointOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "unknown";
  }
  return path
    .split("/")
    .map((segment) => (/^[0-9a-z]{16,}$/i.test(segment) || /^\d+$/.test(segment) ? "{id}" : segment))
    .join("/")
    .slice(0, 120);
}

export function recordApiCall(keyId: string | null, endpoint: string, status: number, durationMs: number) {
  const day = dayKey();
  const owner = keyId ?? "";
  const key = `${day}|${owner}|${endpoint}|${status}`;
  const existing = pending.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += durationMs;
  } else {
    pending.set(key, { day, keyId: owner, endpoint, status, count: 1, totalMs: Math.round(durationMs) });
  }

  // A burst that fills the buffer flushes immediately, so an unbounded map cannot grow
  // between ticks.
  if (pending.size >= MAX_PENDING) {
    void flushApiUsage();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => { void flushApiUsage(); }, FLUSH_MS);
    // The process must not be held open by a counter flush.
    timer.unref?.();
  }
}

/** Writes the buffer out. Exported so a test — or a shutdown — can force it. */
export async function flushApiUsage(): Promise<number> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) return 0;
  const batch = [...pending.values()];
  pending.clear();

  for (const row of batch) {
    try {
      // Upsert rather than create: the same (day, key, endpoint, status) is written once
      // per flush window, and every later window adds to what is already there.
      await prisma.apiUsageDaily.upsert({
        where: { day_keyId_endpoint_status: { day: row.day, keyId: row.keyId, endpoint: row.endpoint, status: row.status } },
        create: row,
        update: { count: { increment: row.count }, totalMs: { increment: row.totalMs } },
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "api.usage.flush_failed", endpoint: row.endpoint, error: String(error).slice(0, 200) }));
    }
  }
  return batch.length;
}

/** Only for tests: the buffer is module-level state that would leak between cases. */
export function resetApiUsage() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
}

// ---- Reading it back, for the console ----

export interface UsageTotals {
  calls: number;
  errors: number;
  rateLimited: number;
  avgMs: number | null;
}

export interface UsageBreakdownRow {
  value: string;
  calls: number;
  errors: number;
}

/** One pass over the window, sliced every way the API screen shows it. */
export async function usageReport(days = 30, now: Date = new Date()) {
  const from = shiftDay(now, -(days - 1));
  const rows = await prisma.apiUsageDaily.findMany({ where: { day: { gte: from } } });

  const totals: UsageTotals = { calls: 0, errors: 0, rateLimited: 0, avgMs: null };
  let weightedMs = 0;
  const byDay = new Map<string, number>();
  const byKey = new Map<string, { calls: number; errors: number }>();
  const byEndpoint = new Map<string, { calls: number; errors: number }>();
  const byStatus = new Map<number, number>();

  for (const row of rows) {
    totals.calls += row.count;
    if (row.status >= 400) totals.errors += row.count;
    if (row.status === 429) totals.rateLimited += row.count;
    weightedMs += row.totalMs;

    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);

    for (const [map, key] of [[byKey, row.keyId] as const, [byEndpoint, row.endpoint] as const]) {
      const bucket = map.get(key) ?? { calls: 0, errors: 0 };
      bucket.calls += row.count;
      if (row.status >= 400) bucket.errors += row.count;
      map.set(key, bucket);
    }
  }
  totals.avgMs = totals.calls === 0 ? null : weightedMs / totals.calls;

  const rank = (map: Map<string, { calls: number; errors: number }>): UsageBreakdownRow[] =>
    [...map.entries()].map(([value, counts]) => ({ value, ...counts })).sort((a, b) => b.calls - a.calls);

  return {
    totals,
    series: Array.from({ length: days }, (_, index) => {
      const day = shiftDay(now, index - days + 1);
      return { label: day.slice(5), primary: byDay.get(day) ?? 0 };
    }),
    byKey: rank(byKey),
    byEndpoint: rank(byEndpoint).slice(0, 12),
    byStatus: [...byStatus.entries()].map(([status, calls]) => ({ status, calls })).sort((a, b) => b.calls - a.calls),
  };
}

/** A per-key sparkline for the key table: calls per day over the window. */
export async function usagePerKey(days = 7, now: Date = new Date()) {
  const from = shiftDay(now, -(days - 1));
  const rows = await prisma.apiUsageDaily.findMany({ where: { day: { gte: from } }, select: { day: true, keyId: true, count: true } });
  const byKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const days_ = byKey.get(row.keyId) ?? new Map<string, number>();
    days_.set(row.day, (days_.get(row.day) ?? 0) + row.count);
    byKey.set(row.keyId, days_);
  }
  const window = Array.from({ length: days }, (_, index) => shiftDay(now, index - days + 1));
  return (keyId: string) => {
    const found = byKey.get(keyId);
    return window.map((day) => ({ label: day.slice(5), primary: found?.get(day) ?? 0 }));
  };
}
