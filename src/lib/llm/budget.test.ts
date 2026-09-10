import assert from "node:assert/strict";
import test from "node:test";
import { budgetVerdict, periodStart, type BudgetRow } from "./budget";

const base: BudgetRow = { scope: "translation", period: "month", limitTokens: null, limitCost: null, enabled: true };

test("a token ceiling bites at or above the cap and reports the fraction", () => {
  const budget = { ...base, limitTokens: 1000 };
  assert.deepEqual(budgetVerdict({ tokens: 500, cost: null }, budget), { over: false, fraction: 0.5 });
  assert.deepEqual(budgetVerdict({ tokens: 1000, cost: null }, budget), { over: true, fraction: 1 });
});

test("a cost ceiling cannot bite while spend is unpriced", () => {
  const budget = { ...base, limitCost: 10 };
  // An unpriced model contributes unknown cost; the cap is not asserted to be breached.
  assert.deepEqual(budgetVerdict({ tokens: 9_999, cost: null }, budget), { over: false, fraction: null });
  assert.equal(budgetVerdict({ tokens: 0, cost: 10 }, budget).over, true);
});

test("with both caps set, the tighter one drives the bar and either can trip it", () => {
  const budget = { ...base, limitTokens: 1000, limitCost: 10 };
  // 90% of tokens but 40% of cost -> fraction tracks the tighter (tokens), not over yet.
  assert.deepEqual(budgetVerdict({ tokens: 900, cost: 4 }, budget), { over: false, fraction: 0.9 });
  // Cost cap reached while tokens are fine -> over.
  assert.equal(budgetVerdict({ tokens: 100, cost: 10 }, budget).over, true);
});

test("a disabled budget never blocks", () => {
  const budget = { ...base, limitTokens: 1, enabled: false };
  assert.deepEqual(budgetVerdict({ tokens: 1_000_000, cost: 999 }, budget), { over: false, fraction: null });
});

test("periodStart returns the day for day and the first of the month for month", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  assert.equal(periodStart("day", now), "2026-09-10");
  assert.equal(periodStart("month", now), "2026-09-01");
});
