import { dayRange, shiftDay } from "../analytics/identity";
import { prisma } from "../db";
import { estimateCost, priceKey, type ModelPrice } from "./usage";

/**
 * What the model calls actually cost, from the counts the providers reported.
 *
 * Every figure here is measured. Nothing is inferred from character counts, which is what
 * had to be done before these rows existed and is accurate to roughly ±20%.
 */

export interface UsageTotals {
  calls: number;
  failed: number;
  /**
   * Calls the model did not finish on its own, having hit the output ceiling.
   *
   * Invisible in every other figure: a cut-off reply bills for every token it produced and
   * counts as a success. It is also usually the reason a caller then pays for a retry, so
   * a raised ceiling can cost less than a low one rather than more.
   */
  truncated: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when any model in the bundle has no price on file; see estimateCost. */
  cost: number | null;
  currency: string;
}

export interface UsageBreakdown extends UsageTotals {
  label: string;
}

export interface UsageReport {
  days: number;
  totals: UsageTotals;
  byTask: UsageBreakdown[];
  byModel: UsageBreakdown[];
  /** Shaped for the shared TimeSeries chart: primary is tokens, secondary is calls. */
  series: { label: string; primary: number; secondary: number }[];
  /** Models seen in the window that nobody has priced, so the console can say so. */
  unpricedModels: string[];
}

function emptyTotals(currency: string): UsageTotals {
  return { calls: 0, failed: 0, truncated: 0, inputTokens: 0, outputTokens: 0, cost: 0, currency };
}

function add(into: UsageTotals, row: { calls: number; failed: number; truncated: number; inputTokens: number; outputTokens: number }, cost: number | null) {
  into.calls += row.calls;
  into.failed += row.failed;
  into.truncated += row.truncated;
  into.inputTokens += row.inputTokens;
  into.outputTokens += row.outputTokens;
  // One unpriced model makes the whole bundle unpriceable rather than quietly cheaper.
  into.cost = into.cost === null || cost === null ? null : into.cost + cost;
}

export async function llmUsageReport(days = 30, now = new Date()): Promise<UsageReport> {
  const from = shiftDay(now, -(days - 1));
  const [rows, priceRows] = await Promise.all([
    prisma.llmCall.groupBy({
      by: ["day", "task", "provider", "model", "ok", "finishReason"],
      where: { day: { gte: from } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.llmModelPrice.findMany(),
  ]);

  const prices = new Map<string, ModelPrice>(
    priceRows.map((row) => [priceKey(row.provider, row.model), { inputPerMTok: row.inputPerMTok, outputPerMTok: row.outputPerMTok, currency: row.currency }]),
  );
  // A single currency keeps the totals addable. The first price entered sets it; mixing
  // currencies is a real possibility but summing them silently would be worse than the
  // console showing one and the operator noticing.
  const currency = priceRows[0]?.currency ?? "USD";

  const totals = emptyTotals(currency);
  const byTask = new Map<string, UsageTotals>();
  const byModel = new Map<string, UsageTotals>();
  const perDay = new Map<string, { primary: number; secondary: number }>();
  const unpriced = new Set<string>();

  for (const row of rows) {
    const entry = {
      calls: row._count._all,
      failed: row.ok ? 0 : row._count._all,
      truncated: row.finishReason === "length" ? row._count._all : 0,
      inputTokens: row._sum.inputTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
    };
    const price = prices.get(priceKey(row.provider, row.model));
    if (!price) unpriced.add(`${row.provider} · ${row.model}`);
    const cost = estimateCost(entry.inputTokens, entry.outputTokens, price);

    add(totals, entry, cost);
    const modelLabel = `${row.provider} · ${row.model}`;
    for (const [map, key] of [[byTask, row.task], [byModel, modelLabel]] as const) {
      const bucket = map.get(key) ?? emptyTotals(currency);
      add(bucket, entry, cost);
      map.set(key, bucket);
    }
    const day = perDay.get(row.day) ?? { primary: 0, secondary: 0 };
    day.primary += entry.inputTokens + entry.outputTokens;
    day.secondary += entry.calls;
    perDay.set(row.day, day);
  }

  const listed = (map: Map<string, UsageTotals>): UsageBreakdown[] =>
    [...map.entries()]
      .map(([label, value]) => ({ label, ...value }))
      .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));

  return {
    days,
    totals,
    byTask: listed(byTask),
    byModel: listed(byModel),
    series: dayRange(days, now).map((day) => ({ label: day, ...(perDay.get(day) ?? { primary: 0, secondary: 0 }) })),
    unpricedModels: [...unpriced].sort(),
  };
}

/**
 * The most recent failures, so a misconfigured key or a truncating token limit is visible
 * as the specific error rather than only as a raised failure rate.
 */
export async function recentLlmFailures(limit = 12) {
  return prisma.llmCall.findMany({
    where: { ok: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, task: true, provider: true, model: true, error: true, createdAt: true, outputTokens: true },
  });
}

/**
 * Drop call rows past the retention window.
 *
 * One row per call is the right grain for answering "what did that cost and why", and the
 * wrong grain to keep forever: at current volume it is roughly a thousand rows a day.
 */
export async function pruneLlmCalls(retentionDays = Number(process.env.LLM_CALL_RETENTION_DAYS || 90), now = new Date()): Promise<number> {
  const cutoff = shiftDay(now, -Math.max(1, retentionDays));
  const { count } = await prisma.llmCall.deleteMany({ where: { day: { lt: cutoff } } });
  return count;
}
