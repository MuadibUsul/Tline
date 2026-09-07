import Link from "next/link";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { age, compact, json, when } from "./_components/format";
import { overview, realtime, windowFor } from "@/lib/analytics/query";
import { pipelineHealth } from "@/../scripts/watchdog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

/**
 * The console's front page.
 *
 * It used to be the crawler screen, which meant every visit — whatever the operator came
 * for — opened on a table of sixty publishers. This answers "is anything wrong, and where"
 * across all of the console's areas, and each card is a way into the section that owns it.
 */
export default async function AdminOverviewPage() {
  const user = (await getSessionUser())!;
  const locale = await getLocale();
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    users, newUsers, activeUsers, suspended,
    analysisReview, translationReview,
    sources, failedJobs, staleJobs,
    keys, recentUsers, recentAudit, health,
    traffic, live,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: week } } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
    prisma.analysis.count({ where: { reviewStatus: "needs_review" } }),
    prisma.articleTranslation.count({ where: { status: "needs_review" } }),
    prisma.institution.findMany({ select: { monitoringEnabled: true, crawlPolicy: true, lastCrawlStatus: true, consecutiveFailures: true } }),
    prisma.jobRun.count({ where: { status: "failed", startedAt: { gte: day } } }),
    prisma.jobRun.count({ where: { status: "running", startedAt: { lt: new Date(Date.now() - 20 * 60_000) } } }),
    prisma.apiKey.findMany({ select: { revokedAt: true, requestCount: true, lastUsedAt: true } }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, email: true, role: true, tier: true, createdAt: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { actor: { select: { email: true } } } }),
    pipelineHealth(),
    overview(windowFor("24h")),
    realtime(),
  ]);

  const monitored = sources.filter((source) => source.monitoringEnabled && ["allowed", "delayed"].includes(source.crawlPolicy)).length;
  const unhealthy = sources.filter((source) => ["failed", "refused", "paused"].includes(source.lastCrawlStatus ?? "") || (!source.monitoringEnabled && source.consecutiveFailures > 0)).length;
  const review = analysisReview + translationReview;
  const activeKeys = keys.filter((key) => !key.revokedAt).length;
  const apiCalls = keys.reduce((total, key) => total + key.requestCount, 0);

  // A card an operator cannot act on is decoration, so each one is a link into the
  // section that can do something about the number it shows.
  const cards: { show: boolean; href: string; label: string; value: string; note: string; alarm?: boolean }[] = [
    {
      show: can(user, "admin.analytics"), href: "/admin/analytics",
      label: tr(locale, "Visitors · 24h", "24 小时访客"), value: compact(traffic.visitors),
      note: tr(locale, `${compact(traffic.views)} views · ${live.visitors} online now`, `浏览 ${compact(traffic.views)} · 当前在线 ${live.visitors}`),
    },
    {
      show: can(user, "admin.users"), href: "/admin/users",
      label: tr(locale, "Accounts", "注册账户"), value: compact(users),
      note: tr(locale, `${newUsers} new / 7d · ${activeUsers} active`, `7 日新增 ${newUsers} · 活跃 ${activeUsers}`),
    },
    {
      show: can(user, "admin.users") && suspended > 0, href: "/admin/users?status=suspended",
      label: tr(locale, "Suspended", "已封禁"), value: String(suspended),
      note: tr(locale, "accounts refused at sign-in", "账户已被拒绝登录"), alarm: true,
    },
    {
      show: can(user, "admin.review"), href: "/admin/review",
      label: tr(locale, "Needs review", "待审核"), value: String(review),
      note: tr(locale, `${analysisReview} analysis · ${translationReview} translation`, `分析 ${analysisReview} · 翻译 ${translationReview}`),
      alarm: review > 20,
    },
    {
      show: can(user, "admin.sources"), href: "/admin/sources",
      label: tr(locale, "Monitored sources", "监控来源"), value: String(monitored),
      note: tr(locale, `${sources.length} total · ${unhealthy} unhealthy`, `共 ${sources.length} 家 · 异常 ${unhealthy}`),
      alarm: unhealthy > 0,
    },
    {
      show: can(user, "admin.review"), href: "/admin/jobs",
      label: tr(locale, "Newest research", "最近入库"),
      value: health.articleAgeHours === null ? "—" : health.articleAgeHours < 1 ? tr(locale, "<1h", "1 小时内") : `${health.articleAgeHours.toFixed(0)}h`,
      note: tr(locale, `${failedJobs} failed / 24h · ${staleJobs} stale`, `24 小时失败 ${failedJobs} · 卡死 ${staleJobs}`),
      alarm: health.stalled.length > 0 || staleJobs > 0,
    },
    {
      show: can(user, "admin.api"), href: "/admin/api",
      label: tr(locale, "API keys", "API 密钥"), value: String(activeKeys),
      note: tr(locale, `${compact(apiCalls)} requests all time`, `累计调用 ${compact(apiCalls)} 次`),
    },
  ];

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Dashboard", "仪表盘")}</h1>
        <p className="sub">{tr(locale, "What needs attention right now, across audience, accounts, the content pipeline and the API.", "跨访问、账户、内容管道与 API 四个方面，当前需要关注的事项。")}</p>
      </div>
    </header>

    <section className="admin-stats admin-stats-6" aria-label={tr(locale, "Console summary", "后台概览")}>
      {cards.filter((card) => card.show).map((card) => (
        <Link className={`admin-stat admin-stat-link${card.alarm ? " admin-stat-alarm" : ""}`} key={card.label} href={localePath(locale, card.href)}>
          <span>{card.label}</span><b>{card.value}</b><small>{card.note}</small>
        </Link>
      ))}
    </section>

    <div className="admin-columns">
      {can(user, "admin.audit") && <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "Latest operator activity", "最近后台操作")}</span>
          <Link className="minibtn" href={localePath(locale, "/admin/audit")}>{tr(locale, "Audit log", "审计日志")} →</Link>
        </div>
        <div className="admin-jobs">
          {recentAudit.length === 0 && <div className="empty-state">{tr(locale, "No operator action has been recorded yet.", "尚未记录任何后台操作。")}</div>}
          {recentAudit.map((entry) => {
            const metadata = json(entry.metadata);
            const name = typeof metadata.name === "string" ? metadata.name : typeof metadata.email === "string" ? metadata.email : entry.targetId;
            return <div className="admin-job" key={entry.id}>
              <div><b>{entry.action}</b><small>{entry.actor?.email ?? tr(locale, "system", "系统")} · {age(entry.createdAt, locale)}</small></div>
              <div className="admin-job-state"><span className="mono admin-metric">{name ?? "—"}</span></div>
            </div>;
          })}
        </div>
      </section>}

      <aside>
        {can(user, "admin.users") && <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Newest accounts", "最新注册")}</span>
            <Link className="minibtn" href={localePath(locale, "/admin/users")}>{tr(locale, "All", "全部")} →</Link>
          </div>
          <div className="admin-review-list">
            {recentUsers.length === 0 && <div className="empty-state">{tr(locale, "No accounts yet.", "尚无账户。")}</div>}
            {recentUsers.map((account) => <div className="admin-review-row" key={account.id}>
              <Link href={localePath(locale, `/admin/users/${account.id}`)}>
                <span><b>{account.email}</b><small>{when(account.createdAt, locale)}</small></span>
                <span className="chip gray">{account.role}</span>
              </Link>
            </div>)}
          </div>
        </section>}
      </aside>
    </div>
  </>;
}
