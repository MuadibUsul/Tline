import assert from "node:assert/strict";
import test from "node:test";
import {
  chineseDateFromEnglishTitle,
  hasGarbledTitleDate,
  protectTitleDates,
  repairChineseTitleDate,
  restoreTitleDates,
} from "./titleDates";

test("protect/restore renders English title dates as clean Chinese dates", () => {
  const dates: string[] = [];
  const protectedTitle = protectTitleDates("OCBC Daily Treasury Outlook (31 Aug 2026)", dates);
  // The English date is replaced by an alpha placeholder the LLM keeps verbatim.
  assert.equal(protectedTitle, "OCBC Daily Treasury Outlook (__TLD_A__)");
  assert.deepEqual(dates, ["2026年8月31日"]);
  // After the (simulated) LLM translation keeps the placeholder, restore fills the clean date.
  assert.equal(restoreTitleDates("华侨银行每日国债展望（__TLD_A__）", dates), "华侨银行每日国债展望（2026年8月31日）");
});

test("alpha placeholder survives digit-based number protection", () => {
  // __TLD_A__ contains no digits, so protectNumbers-style regex must not touch it.
  assert.equal(/(?:[$€£¥]\s*)?[+-]?\d[\d,]*(?:\.\d+)?/.test("__TLD_A__"), false);
});

test("supports the common English date shapes", () => {
  assert.equal(chineseDateFromEnglishTitle("Australia and NZ Weekly 31 August 2026"), "2026年8月31日");
  assert.equal(chineseDateFromEnglishTitle("SMC Podcast 26 August 2026"), "2026年8月26日");
  assert.equal(chineseDateFromEnglishTitle("OCBC Daily Treasury Outlook (21 Aug 2026)"), "2026年8月21日");
  assert.equal(chineseDateFromEnglishTitle("Outlook - Aug 5, 2026"), "2026年8月5日");
  assert.equal(chineseDateFromEnglishTitle("Report 2026-08-31"), "2026年8月31日");
  assert.equal(chineseDateFromEnglishTitle("Monthly Note Aug 2026"), "2026年8月");
  assert.equal(chineseDateFromEnglishTitle("No date here"), null);
});

test("repairs garbled/foreign dates in stored Chinese titles from the English source", () => {
  assert.equal(
    repairChineseTitleDate("华侨银行每日外汇与利率展望（31年2026月）", "OCBC Daily Treasury Outlook (31 Aug 2026)"),
    "华侨银行每日外汇与利率展望（2026年8月31日）",
  );
  assert.equal(
    repairChineseTitleDate("华侨银行每日国库展望（21年2026月1日）", "OCBC Daily Treasury Outlook (21 Aug 2026)"),
    "华侨银行每日国库展望（2026年8月21日）",
  );
  assert.equal(
    repairChineseTitleDate("澳大利亚和新西兰周报 31 八月 2026", "Australia and NZ Weekly 31 August 2026"),
    "澳大利亚和新西兰周报 2026年8月31日",
  );
  assert.equal(
    repairChineseTitleDate("SMC播客 26 八月 2026", "SMC Podcast 26 August 2026"),
    "SMC播客 2026年8月26日",
  );
});

test("leaves clean titles untouched", () => {
  assert.equal(hasGarbledTitleDate("华侨银行每日国债展望（2026年8月31日）"), false);
  assert.equal(repairChineseTitleDate("稳定币：企业与金融机构须知", "Stablecoins: what firms need to know"), "稳定币：企业与金融机构须知");
});
