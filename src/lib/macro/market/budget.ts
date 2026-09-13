import { prisma } from "../../db";

export interface ProviderBudgetConfig {
  minute: number;
  day: number;
  timezone: string;
}

export function marketBudgetConfig(): ProviderBudgetConfig {
  const finite = (value: string | undefined, fallback: number) => {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
  };
  return {
    minute: finite(process.env.MARKET_BUDGET_PER_MINUTE, 8),
    day: finite(process.env.MARKET_BUDGET_PER_DAY, 800),
    timezone: process.env.MARKET_BUDGET_RESET_TIMEZONE || "UTC",
  };
}

export function budgetPeriodKeys(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).reduce<Record<string, string>>((out, part) => { if (part.type !== "literal") out[part.type] = part.value; return out; }, {});
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { minute: `${day}T${parts.hour}:${parts.minute}`, day };
}

export function budgetAllows(used: number, cost: number, limit: number) {
  return Number.isInteger(cost) && cost > 0 && (limit === 0 || used + cost <= limit);
}

/** Reserve credits before the request. The scheduler already serializes provider work. */
export async function reserveProviderBudget(provider: string, cost: number, now = new Date(), config = marketBudgetConfig()) {
  const keys = budgetPeriodKeys(now, config.timezone);
  return prisma.$transaction(async (tx) => {
    for (const window of ["minute", "day"] as const) {
      const current = await tx.providerUsage.findUnique({ where: { provider_window_periodKey: { provider, window, periodKey: keys[window] } } });
      if (!budgetAllows(current?.usedUnits ?? 0, cost, config[window])) return { allowed: false, reason: `${window}_budget_exhausted`, keys };
    }
    for (const window of ["minute", "day"] as const) {
      await tx.providerUsage.upsert({
        where: { provider_window_periodKey: { provider, window, periodKey: keys[window] } },
        create: { provider, window, periodKey: keys[window], usedUnits: cost },
        update: { usedUnits: { increment: cost } },
      });
    }
    return { allowed: true, reason: null, keys };
  });
}
