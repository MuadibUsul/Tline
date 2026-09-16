import assert from "node:assert/strict";
import test from "node:test";
import { registrationNoticeText } from "../social/registrationNotice";
import { startOfZoneDay, zoneDayKey, zoneHour } from "../zoneTime";
import { renderDailyReportCard, renderDailyReportText, type DailyReport } from "../reports/dailyReport";

test("the Beijing day boundary is the zone's midnight, not UTC's", () => {
  // 2026-09-17 00:30 Beijing is still 2026-09-16 in UTC; the report must call it the 17th.
  const justAfterMidnight = new Date("2026-09-16T16:30:00.000Z");
  assert.equal(zoneDayKey(justAfterMidnight, "Asia/Shanghai"), "2026-09-17");
  assert.equal(zoneHour(justAfterMidnight, "Asia/Shanghai"), 0);
  const start = startOfZoneDay(justAfterMidnight, "Asia/Shanghai");
  assert.equal(start.toISOString(), "2026-09-16T16:00:00.000Z");
  // 08:00 in Beijing is midnight UTC, which is when the report goes out.
  assert.equal(zoneHour(new Date("2026-09-17T00:00:00.000Z"), "Asia/Shanghai"), 8);
  assert.equal(zoneHour(new Date("2026-09-17T00:59:00.000Z"), "Asia/Shanghai"), 8);
  assert.equal(zoneHour(new Date("2026-09-17T01:00:00.000Z"), "Asia/Shanghai"), 9);
});

test("the registration notice says who arrived, how, and how many that makes", () => {
  const text = registrationNoticeText({
    email: "new.reader@example.com",
    name: "New Reader",
    source: "email",
    createdAt: new Date("2026-09-17T01:12:00.000Z"),
    totalUsers: 1240,
    newToday: 3,
    adminUrl: "https://tlines.tech/zh/admin/users",
  });
  assert.match(text, /新用户注册/);
  assert.match(text, /new\.reader@example\.com/);
  assert.match(text, /邮箱一次性链接/);
  assert.match(text, /累计注册：1240 人 · 今日新增 3 人/);
  assert.match(text, /https:\/\/tlines\.tech\/zh\/admin\/users/);
  // Rendered in Beijing time, which is what the operator reads.
  assert.match(text, /09:12/);
});

const report: DailyReport = {
  generatedAt: new Date("2026-09-17T00:00:30.000Z"),
  zoneDay: "2026-09-17",
  windowLabel: "过去 24 小时",
  traffic: {
    visitors: 812, views: 2400, sessions: 950, visitorsChange: 12.4, viewsChange: -3.1, bounceRate: 0.42, onlineNow: 7,
    topPages: [{ value: "/zh/research/example", views: 120, visitors: 90 }],
    topSources: [{ value: "google.com", views: 300 }],
    topCountries: [{ value: "CN", views: 500 }],
    devices: [{ value: "desktop", views: 900 }],
    events: [{ name: "search.select", count: 30, visitors: 25 }],
  },
  accounts: { newUsers: 3, totalUsers: 1240, activeUsers: 120, invited: 40 },
  content: { ingested: 18, published: 12, analysed: 12, translated: 9 },
  releases: [
    { title: "美国每周石油状况报告", importance: 4, verdict: "低于预期", actual: "423429", consensus: "424000", analysed: true },
    { title: "FOMC Policy Decision", importance: 5, verdict: "符合预期", actual: "4", consensus: "4", analysed: false },
  ],
  publishing: { draftsCreated: 4, published: 3, failed: 1, pendingReview: 2 },
  api: { calls: 1500, errors: 4 },
  health: { failedJobs: [{ name: "macro:sync", error: "provider timeout" }], refusedSources: 1, pausedSources: 2 },
  links: { site: "https://tlines.tech", analytics: "https://tlines.tech/zh/admin/analytics", jobs: "https://tlines.tech/zh/admin/jobs", users: "https://tlines.tech/zh/admin/users" },
};

test("the report states the day's numbers, including what needs a person", () => {
  const text = renderDailyReportText(report);
  assert.match(text, /访客 812（\+12%）/);
  assert.match(text, /浏览 2400（-3%）/);
  assert.match(text, /新增 3 · 活跃登录 120 · 累计 1240/);
  assert.match(text, /新入库研报 18/);
  assert.match(text, /美国每周石油状况报告（低于预期，已出解读）/);
  // A five-star release captured without a read-out is the failure this report exists to catch.
  assert.match(text, /FOMC Policy Decision（符合预期，缺解读）/);
  assert.match(text, /待审核 2/);
  assert.match(text, /任务失败：macro:sync：provider timeout/);
  assert.match(text, /拒绝访问来源 1/);
});

test("the card carries the same facts and no missing value leaks into it", () => {
  const card = JSON.stringify(renderDailyReportCard(report));
  assert.match(card, /Tlines 日报/);
  assert.match(card, /812/);
  assert.match(card, /缺解读/);
  assert.match(card, /需要处理/);
  assert.equal(/undefined|null|NaN/.test(card), false);
});

test("a quiet day still renders a complete report", () => {
  const quiet: DailyReport = {
    ...report,
    traffic: { ...report.traffic, visitors: 0, views: 0, sessions: 0, visitorsChange: null, viewsChange: null, bounceRate: null, onlineNow: 0, topPages: [], topSources: [], topCountries: [], devices: [], events: [] },
    accounts: { newUsers: 0, totalUsers: 1240, activeUsers: 0, invited: 40 },
    content: { ingested: 0, published: 0, analysed: 0, translated: 0 },
    releases: [],
    publishing: { draftsCreated: 0, published: 0, failed: 0, pendingReview: 0 },
    api: { calls: 0, errors: 0 },
    health: { failedJobs: [], refusedSources: 0, pausedSources: 0 },
  };
  const text = renderDailyReportText(quiet);
  assert.match(text, /访客 0（—）/);
  assert.match(text, /无已发布数据/);
  assert.match(text, /【需要处理】无失败任务/);
  const card = JSON.stringify(renderDailyReportCard(quiet));
  assert.equal(/undefined|null|NaN/.test(card), false);
  assert.match(card, /无已发布数据/);
});
