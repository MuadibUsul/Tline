import { prisma } from "../db";
import { breakdown, events, overview, realtime, windowFor } from "../analytics/query";
import { dayKey } from "../analytics/identity";
import { siteUrl } from "../site";
import { REPORT_ZONE, zoneDayKey } from "../zoneTime";

/**
 * The morning report.
 *
 * Designed to be read in one glance before the day starts: what happened to the audience,
 * what the platform did on its own, which data printed, and — the part that needs a human —
 * anything that broke or is waiting for one. Every number is a query rather than a stored
 * rollup, so a missed rollup does not produce a misleading morning; the window is a rolling
 * 24 hours, stated as such, because the audience is global and "yesterday" would be a
 * different set of hours for each reader.
 */
export const REPORT_WINDOW_LABEL = "过去 24 小时";

export interface DailyReport {
  generatedAt: Date;
  zoneDay: string;
  windowLabel: string;
  traffic: {
    visitors: number;
    views: number;
    sessions: number;
    visitorsChange: number | null;
    viewsChange: number | null;
    bounceRate: number | null;
    onlineNow: number;
    topPages: Array<{ value: string; views: number; visitors: number }>;
    topSources: Array<{ value: string; views: number }>;
    topCountries: Array<{ value: string; views: number }>;
    devices: Array<{ value: string; views: number }>;
    events: Array<{ name: string; count: number; visitors: number }>;
  };
  accounts: { newUsers: number; totalUsers: number; activeUsers: number; invited: number };
  content: { ingested: number; published: number; analysed: number; translated: number };
  releases: Array<{ title: string; importance: number; verdict: string; actual: string | null; consensus: string | null; analysed: boolean }>;
  publishing: { draftsCreated: number; published: number; failed: number; pendingReview: number };
  api: { calls: number; errors: number };
  health: { failedJobs: Array<{ name: string; error: string | null }>; refusedSources: number; pausedSources: number };
  links: { site: string; analytics: string; jobs: string; users: string };
}

const shortError = (error: string | null) => (error ? error.replace(/\s+/g, " ").slice(0, 120) : null);

export async function buildDailyReport(now = new Date()): Promise<DailyReport> {
  const window = windowFor("24h", now);
  const from = window.from;
  const to = window.to;
  const today = zoneDayKey(now, REPORT_ZONE);
  const yesterday = zoneDayKey(new Date(now.getTime() - 86_400_000), REPORT_ZONE);
  const dayKeys = [...new Set([dayKey(from), dayKey(to), today, yesterday])];

  const [
    trafficOverview, live, topPages, topSources, topCountries, devices, eventRows,
    newUsers, totalUsers, activeUsers, invited,
    ingested, published, analysed, translated,
    releases, draftsCreated, deliverySuccess, deliveryFailed, pendingReview,
    apiRows, failedJobs, refusedSources, pausedSources,
  ] = await Promise.all([
    overview(window),
    realtime(now),
    breakdown("path", window, 5),
    breakdown("referrerHost", window, 3),
    breakdown("country", window, 3),
    breakdown("device", window, 3),
    events(window, 5),
    prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gte: from, lte: to } } }),
    prisma.user.count({ where: { passwordHash: null, suspendedAt: null } }),
    prisma.article.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.article.count({ where: { publishedAt: { gte: from, lte: to } } }),
    prisma.analysis.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.articleTranslation.count({ where: { translatedAt: { gte: from, lte: to } } }),
    prisma.macroRelease.findMany({
      where: { status: "RELEASED", releasedAt: { gte: from, lte: to } },
      orderBy: { releasedAt: "desc" },
      take: 8,
      include: { values: { orderBy: { createdAt: "asc" }, take: 1, select: { actualInitial: true, consensusAtRelease: true } } },
    }),
    prisma.socialDraft.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.socialDelivery.count({ where: { status: "SUCCEEDED", publishedAt: { gte: from, lte: to } } }),
    prisma.socialDelivery.count({ where: { status: "FAILED", updatedAt: { gte: from, lte: to } } }),
    prisma.socialDraft.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.apiUsageDaily.findMany({ where: { day: { in: dayKeys } }, select: { count: true, status: true } }),
    prisma.jobRun.findMany({ where: { status: "failed", startedAt: { gte: from, lte: to } }, orderBy: { startedAt: "desc" }, take: 5, select: { name: true, error: true } }),
    prisma.institution.count({ where: { lastCrawlStatus: "refused" } }),
    prisma.institution.count({ where: { lastCrawlStatus: "paused" } }),
  ]);

  const apiCalls = apiRows.reduce((sum, row) => sum + row.count, 0);
  const apiErrors = apiRows.filter((row) => row.status >= 400).reduce((sum, row) => sum + row.count, 0);

  return {
    generatedAt: now,
    zoneDay: today,
    windowLabel: REPORT_WINDOW_LABEL,
    traffic: {
      visitors: trafficOverview.visitors,
      views: trafficOverview.views,
      sessions: trafficOverview.sessions,
      visitorsChange: trafficOverview.visitorsChange,
      viewsChange: trafficOverview.viewsChange,
      bounceRate: trafficOverview.bounceRate,
      onlineNow: live.visitors,
      topPages: topPages.map((row) => ({ value: row.value, views: row.views, visitors: row.visitors })),
      topSources: topSources.map((row) => ({ value: row.value, views: row.views })),
      topCountries: topCountries.map((row) => ({ value: row.value, views: row.views })),
      devices: devices.map((row) => ({ value: row.value, views: row.views })),
      events: eventRows,
    },
    accounts: { newUsers, totalUsers, activeUsers, invited },
    content: { ingested, published, analysed, translated },
    releases: releases.map((release) => {
      const value = release.values[0];
      const actual = value?.actualInitial !== null && value?.actualInitial !== undefined ? value.actualInitial.toString() : null;
      const consensus = value?.consensusAtRelease !== null && value?.consensusAtRelease !== undefined ? value.consensusAtRelease.toString() : null;
      const verdict = actual === null ? "未捕获数值" : consensus === null ? "无发布前预期" : Number(actual) === Number(consensus) ? "符合预期" : Number(actual) > Number(consensus) ? "高于预期" : "低于预期";
      return { title: release.titleZh?.trim() || release.titleEn, importance: release.importance, verdict, actual, consensus, analysed: Boolean(release.analysisAt) };
    }),
    publishing: { draftsCreated, published: deliverySuccess, failed: deliveryFailed, pendingReview },
    api: { calls: apiCalls, errors: apiErrors },
    health: { failedJobs: failedJobs.map((job) => ({ name: job.name, error: shortError(job.error) })), refusedSources, pausedSources },
    links: {
      site: siteUrl(),
      analytics: `${siteUrl()}/zh/admin/analytics`,
      jobs: `${siteUrl()}/zh/admin/jobs`,
      users: `${siteUrl()}/zh/admin/users`,
    },
  };
}

/** Signed change, for a number the reader compares with the day before. */
function delta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(0)}%`;

/** The plain-text form, also used by `--print` and by tests. */
export function renderDailyReportText(report: DailyReport): string {
  const lines = [
    `📊 Tlines 日报 · ${report.windowLabel}（生成于 ${report.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC）`,
    "",
    `【流量】访客 ${report.traffic.visitors}（${delta(report.traffic.visitorsChange)}）· 浏览 ${report.traffic.views}（${delta(report.traffic.viewsChange)}）· 会话 ${report.traffic.sessions} · 跳出率 ${pct(report.traffic.bounceRate)} · 当前在线 ${report.traffic.onlineNow}`,
    report.traffic.topPages.length ? `  热门页面：${report.traffic.topPages.map((page) => `${page.value} ${page.views}`).join(" · ")}` : "  热门页面：无",
    report.traffic.topSources.length ? `  来源：${report.traffic.topSources.map((row) => `${row.value} ${row.views}`).join(" · ")}` : null,
    report.traffic.topCountries.length ? `  国家/地区：${report.traffic.topCountries.map((row) => `${row.value} ${row.views}`).join(" · ")}` : null,
    "",
    `【账户】新增 ${report.accounts.newUsers} · 活跃登录 ${report.accounts.activeUsers} · 累计 ${report.accounts.totalUsers} · 待设置密码 ${report.accounts.invited}`,
    "",
    `【内容】新入库研报 ${report.content.ingested} · 新上线 ${report.content.published} · 新增分析 ${report.content.analysed} · 新增译文 ${report.content.translated}`,
    "",
    report.releases.length
      ? `【数据发布】${report.releases.map((release) => `${release.title}（${release.verdict}${release.analysed ? "，已出解读" : "，缺解读"}）`).join("；")}`
      : "【数据发布】过去 24 小时无已发布数据",
    "",
    `【发布】新增草稿 ${report.publishing.draftsCreated} · 已发推文 ${report.publishing.published} · 失败 ${report.publishing.failed} · 待审核 ${report.publishing.pendingReview}`,
    `【API】调用 ${report.api.calls} · 错误 ${report.api.errors}`,
    "",
    `【需要处理】${report.health.failedJobs.length ? report.health.failedJobs.map((job) => `任务失败：${job.name}${job.error ? `：${job.error}` : ""}`).join("；") : "无失败任务"}${report.health.refusedSources ? ` · 拒绝访问来源 ${report.health.refusedSources}` : ""}${report.health.pausedSources ? ` · 暂停来源 ${report.health.pausedSources}` : ""}`,
    "",
    `站点 ${report.links.site} · 分析看板 ${report.links.analytics}`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * The card. Sections are ordered the way the day is: audience, accounts, content, data,
 * publishing, then what needs a person.
 */
export function renderDailyReportCard(report: DailyReport) {
  const md = (value: string) => ({ tag: "markdown", content: value });
  const mark = (value: string) => value.startsWith("+") ? `🟢 ${value}` : value.startsWith("-") ? `🔴 ${value}` : value;
  const releases = report.releases.length
    ? report.releases.map((release) => `- **${release.title}** · ${release.verdict}${release.actual ? `（公布 ${release.actual}${release.consensus ? ` / 预期 ${release.consensus}` : ""}）` : ""}${release.analysed ? "" : " · ⚠️ 缺解读"}`).join("\n")
    : "无已发布数据";
  const attention = [
    ...report.health.failedJobs.map((job) => `- ❌ 任务失败：**${job.name}**${job.error ? ` — ${job.error}` : ""}`),
    report.health.refusedSources ? `- ⛔ 拒绝访问的来源：${report.health.refusedSources}` : null,
    report.health.pausedSources ? `- ⏸ 暂停的来源：${report.health.pausedSources}` : null,
    report.publishing.pendingReview > 0 ? `- 📝 待审核草稿：${report.publishing.pendingReview}` : null,
    report.releases.some((release) => !release.analysed) ? "- ⚠️ 有数据发布缺少解读" : null,
  ].filter(Boolean).join("\n") || "无";

  return {
    schema: "2.0",
    header: {
      template: report.health.failedJobs.length ? "orange" : "blue",
      title: { tag: "plain_text", content: `Tlines 日报 · ${report.windowLabel}`.slice(0, 100) },
    },
    body: {
      elements: [
        md(`**流量**\n访客 **${report.traffic.visitors}**（${mark(delta(report.traffic.visitorsChange))}） · 浏览 **${report.traffic.views}**（${mark(delta(report.traffic.viewsChange))}） · 会话 ${report.traffic.sessions} · 跳出率 ${pct(report.traffic.bounceRate)} · 在线 ${report.traffic.onlineNow}`),
        report.traffic.topPages.length ? md(`**热门页面**\n${report.traffic.topPages.map((page) => `${page.views} · ${page.value}`).join("\n")}`) : null,
        md(`**账户**\n新增 **${report.accounts.newUsers}** · 活跃登录 ${report.accounts.activeUsers} · 累计 ${report.accounts.totalUsers} · 待设置密码 ${report.accounts.invited}`),
        md(`**内容**\n新入库研报 ${report.content.ingested} · 新上线 ${report.content.published} · 新增分析 ${report.content.analysed} · 新增译文 ${report.content.translated}`),
        md(`**数据发布**\n${releases}`),
        md(`**发布与接口**\n草稿 ${report.publishing.draftsCreated} · 已发推文 ${report.publishing.published} · 失败 ${report.publishing.failed} · 待审核 ${report.publishing.pendingReview}\nAPI 调用 ${report.api.calls} · 错误 ${report.api.errors}`),
        md(`**需要处理**\n${attention}`),
        { tag: "div", text: { tag: "plain_text", content: `${zoneDayKeyLabel(report)} · 分析看板 ${report.links.analytics}`, text_size: "notation" } },
      ].filter(Boolean),
    },
  };
}

function zoneDayKeyLabel(report: DailyReport) {
  return `${report.zoneDay}（北京）`;
}
