import assert from "node:assert/strict";
import test from "node:test";
import { validateTranslation } from "./quality";

test("accepts a translation that preserves numbers, bps and tickers", () => {
  const result = validateTranslation(
    "Gold rises 2.5% as the Fed cuts 25 bps. XAUUSD target is $4,900.",
    "随着美联储降息 25 个基点，黄金上涨 2.5%。XAUUSD 的目标价为 $4,900。",
    2,
    2,
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("treats translated month names as the same numeric month", () => {
  const result = validateTranslation(
    "Rates were cut in August after guidance issued in June and April.",
    "继6月和4月发布指引后，央行于8月降息。",
  );
  assert.equal(result.passed, true);
});

test("rejects missing or invented numbers", () => {
  const result = validateTranslation(
    "The target rises from $4,700 to $4,900.",
    "目标价从 $4,700 上调至 $5,000。",
  );
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "number_missing"));
  assert.ok(result.issues.some((issue) => issue.code === "number_added"));
});

test("rejects a missing ticker and changed segment count", () => {
  const result = validateTranslation("WTI remains bearish.", "原油观点仍然偏空。", 2, 1);
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "ticker_missing"));
  assert.ok(result.issues.some((issue) => issue.code === "structure"));
});
