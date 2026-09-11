import assert from "node:assert/strict";
import test from "node:test";
import { articleTimestamp, assetName, domainTerm, getAdminLocale, institutionName, localizeChineseContent, localizedDataValue, localeSafeText, relativeTime, resolveLocale, tr } from "./i18n";

test("articleTimestamp keeps a publisher time but falls back to discovery time for date-only publications", () => {
  // Publisher gave a real time-of-day -> used verbatim.
  const precise = new Date("2026-08-31T14:32:00Z");
  assert.equal(articleTimestamp(precise, new Date("2026-08-31T09:00:00Z")).toISOString(), precise.toISOString());
  // Date-only (midnight) publication -> discovery time-of-day carried onto the publication day.
  const dateOnly = new Date("2026-08-28T00:00:00Z");
  const discovered = new Date("2026-08-31T10:40:19Z");
  assert.equal(articleTimestamp(dateOnly, discovered).toISOString(), "2026-08-28T10:40:19.000Z");
  // A publication dated today but discovered late yesterday must not read as a future time.
  assert.equal(
    articleTimestamp(new Date("2026-09-01T00:00:00Z"), new Date("2026-08-31T23:50:00Z")).toISOString(),
    "2026-08-31T23:50:00.000Z",
  );
});

test("relativeTime is minute-precise between one hour and one day", () => {
  const now = Date.now();
  assert.equal(relativeTime(new Date(now - (2 * 3600 + 9 * 60) * 1000), "zh-CN"), "2小时9分钟前");
  assert.equal(relativeTime(new Date(now - 2 * 3600 * 1000), "zh-CN"), "2小时前");
  assert.equal(relativeTime(new Date(now - 15 * 60 * 1000), "zh-CN"), "15分钟前");
});

test("resolves an explicit locale before browser language", () => {
  assert.equal(resolveLocale("en", "zh-CN,zh;q=0.9"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(resolveLocale(undefined, "zh-CN,zh;q=0.9"), "zh-CN");
  assert.equal(resolveLocale(undefined, "en-US,en;q=0.9"), "en");
  assert.equal(tr("zh-CN", "Research", "研报"), "研报");
});

test("the operations console is always Chinese", async () => {
  assert.equal(await getAdminLocale(), "zh-CN");
});

test("localizes canonical institution, asset and domain names without contaminating English", () => {
  assert.equal(institutionName("Goldman Sachs", "zh-CN"), "高盛");
  assert.equal(institutionName("goldman-sachs", "zh-CN"), "高盛");
  assert.equal(institutionName("Goldman Sachs", "en"), "Goldman Sachs");
  assert.equal(assetName("Gold", "zh-CN", "XAUUSD"), "黄金");
  assert.equal(assetName("Gold", "en", "XAUUSD"), "Gold");
  assert.equal(domainTerm("market_impact", "zh-CN"), "市场影响");
  assert.equal(localeSafeText("黄金主线", "en", "Custom theme"), "Custom theme");
  assert.equal(localizedDataValue("September hike unlikely", "zh-CN"), null);
  assert.equal(localizedDataValue("USD 503bn", "zh-CN"), "USD 503bn");
  assert.equal(localizeChineseContent("Isabel Schnabel at Westpac IQ"), "伊莎贝尔·施纳贝尔 at 西太平洋银行研究平台");
});

test("the feed orders on the timestamp the card shows, not the stored one", async () => {
  const { byDisplayRecency } = await import("./queries");
  const dateOnly = {
    // Published with a date but no time, discovered late in the evening.
    publishedAt: new Date("2026-09-02T00:00:00.000Z"),
    createdAt: new Date("2026-09-02T20:00:00.000Z"),
  };
  const timed = {
    publishedAt: new Date("2026-09-02T14:30:00.000Z"),
    createdAt: new Date("2026-09-02T14:35:00.000Z"),
  };
  // Sorting on publishedAt alone would put the timed one first, though the other is
  // displayed as six hours newer.
  assert.deepEqual([timed, dateOnly].sort(byDisplayRecency), [dateOnly, timed]);
});
