import { dayKey } from "../analytics/identity";
import { estimateCost, priceKey, type ModelPrice } from "./usage";
import { LLM_TASKS, type LlmTask } from "./types";

/**
 * Spending ceilings, and the automatic stop that enforces them.
 *
 * The routing table (LlmTaskRoute) answers "should this task run"; a budget answers "how
 * much may it spend before it stops on its own". Every model call already writes an LlmCall
 * row with the provider's own token counts, so the spend a budget is measured against is the
 * same measured figure the console reports — no second accounting to drift apart.
 */

export const GLOBAL_SCOPE = "*";
export type BudgetScope = typeof GLOBAL_SCOPE | LlmTask;
export type BudgetPeriod = "day" | "month";

export interface BudgetRow {
  scope: string;
  period: string;
  limitTokens: number | null;
  limitCost: number | null;
  enabled: boolean;
}

/** Measured spend for one scope over the period a budget is watching. */
export interface Spend {
  tokens: number;
  /** Null when any model in the scope is unpriced — cost cannot be asserted, see estimateCost. */
  cost: number | null;
}

export interface BudgetStatus {
  scope: string;
  period: BudgetPeriod;
  limitTokens: number | null;
  limitCost: number | null;
  enabled: boolean;
  spentTokens: number;
  spentCost: number | null;
  currency: string;
  /** 0–1 of the tighter of the two ceilings, for the console's bar. Null when uncapped. */
  fraction: number | null;
  /** True when an enabled ceiling has been reached and calls for this scope are paused. */
  over: boolean;
}

function isPeriod(value: string): value is BudgetPeriod {
  return value === "day" || value === "month";
}

/**
 * The first UTC day of the window a period covers, as a YYYY-MM-DD string.
 *
 * Returned as the same day-string the LlmCall rows are keyed by, so a budget filters on the
 * indexed `day` column with a plain `gte` — lexicographic order on YYYY-MM-DD is calendar
 * order, and it stays portable between SQLite and PostgreSQL.
 */
export function periodStart(period: BudgetPeriod, now: Date = new Date()): string {
  if (period === "day") return dayKey(now);
  return `${dayKey(now).slice(0, 7)}-01`;
}

/**
 * Whether a scope's spend has reached one of its enabled ceilings, and how close it is.
 *
 * Pure and side-effect free, so the arithmetic that decides whether calls stop is unit
 * tested without a database. A ceiling of null is "no cap"; a cost ceiling with unknown
 * spend (an unpriced model) cannot be breached and is treated as not-over.
 */
export function budgetVerdict(spend: Spend, budget: BudgetRow): { over: boolean; fraction: number | null } {
  if (!budget.enabled) return { over: false, fraction: null };
  const fractions: number[] = [];
  let over = false;
  if (budget.limitTokens != null && budget.limitTokens > 0) {
    fractions.push(spend.tokens / budget.limitTokens);
    if (spend.tokens >= budget.limitTokens) over = true;
  }
  if (budget.limitCost != null && budget.limitCost > 0 && spend.cost != null) {
    fractions.push(spend.cost / budget.limitCost);
    if (spend.cost >= budget.limitCost) over = true;
  }
  return { over, fraction: fractions.length ? Math.min(1, Math.max(...fractions)) : null };
}

interface SpendTable {
  currency: string;
  /** scope -> period -> spend. Global (`*`) is the sum of every task. */
  byScope: Map<string, Record<BudgetPeriod, Spend>>;
}

function blankSpend(): Record<BudgetPeriod, Spend> {
  return { day: { tokens: 0, cost: 0 }, month: { tokens: 0, cost: 0 } };
}

function addInto(target: Spend, tokens: number, cost: number | null) {
  target.tokens += tokens;
  // One unpriced model makes the scope's cost unknowable rather than quietly cheaper.
  target.cost = target.cost === null || cost === null ? null : target.cost + cost;
}

/**
 * Measured spend for the current day and month, per task and summed into the global scope.
 *
 * A single grouped read covering the month (the wider window) serves both periods: today's
 * rows are the subset whose day is today. The prices are the same table the cost report
 * uses, so a budget and the console agree to the token.
 */
async function loadSpend(now: Date = new Date()): Promise<SpendTable> {
  const { prisma } = await import("../db");
  const monthStart = periodStart("month", now);
  const today = dayKey(now);
  const [rows, priceRows] = await Promise.all([
    prisma.llmCall.groupBy({
      by: ["day", "task", "provider", "model"],
      where: { day: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.llmModelPrice.findMany(),
  ]);

  const prices = new Map<string, ModelPrice>(
    priceRows.map((row) => [priceKey(row.provider, row.model), { inputPerMTok: row.inputPerMTok, outputPerMTok: row.outputPerMTok, currency: row.currency }]),
  );
  const byScope = new Map<string, Record<BudgetPeriod, Spend>>();
  const bucket = (scope: string) => {
    let entry = byScope.get(scope);
    if (!entry) byScope.set(scope, (entry = blankSpend()));
    return entry;
  };

  for (const row of rows) {
    const tokens = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
    const cost = estimateCost(row._sum.inputTokens ?? 0, row._sum.outputTokens ?? 0, prices.get(priceKey(row.provider, row.model)));
    for (const scope of [row.task, GLOBAL_SCOPE]) {
      const entry = bucket(scope);
      addInto(entry.month, tokens, cost);
      if (row.day === today) addInto(entry.day, tokens, cost);
    }
  }

  return { currency: priceRows[0]?.currency ?? "USD", byScope };
}

function spendFor(table: SpendTable, scope: string, period: BudgetPeriod): Spend {
  return table.byScope.get(scope)?.[period] ?? { tokens: 0, cost: 0 };
}

/**
 * Short-lived cache of which scopes are over budget.
 *
 * Enforcement runs before every model call, and an aggregate read per call would cost more
 * than the budget saves. The window is a few seconds: a scope can overshoot its ceiling by
 * at most one window's worth of calls before the next reload notices, which is the same
 * eventual-consistency trade the provider-config cache already makes across processes.
 */
const CACHE_TTL_MS = Math.max(0, Number(process.env.LLM_BUDGET_CACHE_MS || 15_000));
let cache: { loadedAt: number; blocked: Set<string> } | null = null;

export function invalidateBudgetCache(): void {
  cache = null;
}

/**
 * The set of scopes whose enabled ceiling is reached right now.
 *
 * Fails open: if the budgets or spend cannot be read the pipeline keeps running rather than
 * halting on a database blip. LLM_DISABLED remains the hard stop that needs no database.
 */
async function blockedScopes(now: Date = new Date()): Promise<Set<string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.blocked;
  const blocked = new Set<string>();
  try {
    const { prisma } = await import("../db");
    const budgets = await prisma.llmBudget.findMany();
    if (budgets.length) {
      const table = await loadSpend(now);
      for (const budget of budgets) {
        const period: BudgetPeriod = isPeriod(budget.period) ? budget.period : "month";
        if (budgetVerdict(spendFor(table, budget.scope, period), budget).over) blocked.add(budget.scope);
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "llm.budget.eval.failed", error: String(error).slice(0, 300) }));
  }
  cache = { loadedAt: Date.now(), blocked };
  return blocked;
}

/**
 * Whether calls for a task must stop now — its own ceiling, or the global one, is reached.
 * Called from resolveWithSource just after the on/off check.
 */
export async function isTaskOverBudget(task: LlmTask, now: Date = new Date()): Promise<boolean> {
  const blocked = await blockedScopes(now);
  return blocked.has(GLOBAL_SCOPE) || blocked.has(task);
}

/**
 * Every scope's current standing, for the console: the global row first, then each task,
 * whether or not a ceiling has been set — an unbudgeted scope still shows what it has spent.
 */
export async function budgetStatuses(now: Date = new Date()): Promise<BudgetStatus[]> {
  const { prisma } = await import("../db");
  const [budgets, table] = await Promise.all([prisma.llmBudget.findMany(), loadSpend(now)]);
  const byScope = new Map(budgets.map((row) => [row.scope, row]));
  const scopes: string[] = [GLOBAL_SCOPE, ...LLM_TASKS];

  return scopes.map((scope) => {
    const budget = byScope.get(scope);
    const period: BudgetPeriod = budget && isPeriod(budget.period) ? budget.period : "month";
    const spend = spendFor(table, scope, period);
    const row: BudgetRow = {
      scope,
      period,
      limitTokens: budget?.limitTokens ?? null,
      limitCost: budget?.limitCost ?? null,
      enabled: budget?.enabled ?? true,
    };
    const { over, fraction } = budget ? budgetVerdict(spend, row) : { over: false, fraction: null };
    return {
      scope,
      period,
      limitTokens: row.limitTokens,
      limitCost: row.limitCost,
      enabled: row.enabled,
      spentTokens: spend.tokens,
      spentCost: spend.cost,
      currency: table.currency,
      fraction,
      over,
    };
  });
}
