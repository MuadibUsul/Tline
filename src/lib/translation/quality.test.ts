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

test("does not interpret the modal verb may as the month May", () => {
  const result = validateTranslation(
    "Markets may rally and yields may fall.",
    "市场可能上涨，收益率可能下降。",
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

// Each case below was an observed false positive: the checker scored a faithful
// translation as defective, which is what drove the corpus mean down to 0.67.
test("repetition counts do not have to match", () => {
  const result = validateTranslation(
    "Growth in 2026 was strong. 2026 also saw 2026 records across the board.",
    "2026年增长强劲，全年屡创纪录。",
  );
  assert.equal(result.passed, true);
});

test("'per cent' in the source matches '%' in the translation", () => {
  const result = validateTranslation("GDP grew 2.7 per cent.", "GDP 增长 2.7%。");
  assert.equal(result.passed, true);
});

test("a currency prefix is not part of the figure", () => {
  const result = validateTranslation("The target is $4,900.", "目标价为 4,900 美元。");
  assert.equal(result.passed, true);
});

test("Chinese 万 regrouping of a written-out number is accepted", () => {
  // 20,000 and 2万 are the same quantity written on different grouping conventions.
  const result = validateTranslation("Payrolls rose by 20,000 in July.", "7月非农就业增加 2万人。");
  assert.equal(result.passed, true);
});

test("a direction sign added by the translation is not an invented figure", () => {
  const result = validateTranslation("The index fell 1.9% last week.", "该指数上周下跌 -1.9%。");
  assert.equal(result.passed, true);
});

test("date separators do not become phantom figures", () => {
  // Only the machine date shapes are stripped. Cross-language date prose (25 August 2026
  // against 2026年8月25日) was tried and measurably lowered scores across the corpus, so
  // the day-of-month there is still compared like any other figure.
  const result = validateTranslation("Published 2026-08-25 with growth of 4.6%.", "发布日期 2026-08-25，增长 4.6%。");
  assert.equal(result.passed, true);
});

test("bare years are not compared", () => {
  const result = validateTranslation("The 2027 outlook improves.", "2027年前景改善。");
  assert.equal(result.passed, true);
});

test("trailing zeros are the same figure", () => {
  const result = validateTranslation("The policy rate is 3%.", "政策利率为 3.00%。");
  assert.equal(result.passed, true);
});

test("a figure genuinely absent from the translation is still caught", () => {
  const result = validateTranslation("Unemployment reached 4.2% in July.", "7月失业率上升。");
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "number_missing"));
});

test("a figure the source never contained is still caught", () => {
  const result = validateTranslation("Unemployment rose in July.", "7月失业率升至 4.2%。");
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.code === "number_added"));
});
