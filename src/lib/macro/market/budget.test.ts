import assert from "node:assert/strict";
import test from "node:test";
import { budgetAllows, budgetPeriodKeys } from "./budget";

test("endpoint weights consume both minute and daily budgets without assuming batches are free", () => {
  assert.equal(budgetAllows(6, 2, 8), true);
  assert.equal(budgetAllows(7, 2, 8), false);
  assert.equal(budgetAllows(799, 1, 800), true);
  assert.equal(budgetAllows(800, 1, 800), false);
});

test("budget keys follow the configured reset timezone", () => {
  const keys = budgetPeriodKeys(new Date("2026-09-12T16:30:00Z"), "Asia/Shanghai");
  assert.equal(keys.day, "2026-09-13");
  assert.equal(keys.minute, "2026-09-13T00:30");
});
