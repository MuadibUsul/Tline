import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { audience, funnel, retention, topUsers } from "@/lib/analytics/query";
import { BarList, StatCard } from "@/app/_components/charts";
import { age, compact, plural } from "../../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visitors & users" };

const FUNNEL_LABEL: Record<string, [string, string]> = {
  visitors: ["Visitors · 30d", "访客 · 30 天"],
  accounts: ["Created an account", "完成注册"],
  watchlist: ["Watched something", "添加关注"],
  alerts: ["Set an alert", "设置提醒"],
};

/**
 * Conversion from the previous step.
 *
 * A rate under one percent is shown as "<1%" rather than rounded to zero: the difference
 * between "nobody converted" and "one in four hundred did" is the whole point of the row.
 */
function share_(count: number, previous: number): string {
  if (previous === 0) return "—";
  const rate = (count / previous) * 100;
  if (rate === 0) return "0%";
  return rate < 1 ? "<1%" : `${rate.toFixed(0)}%`;
}

/** A retention cell's colour band. Five steps: enough to read a shape, not a gradient. */
function band(value: number | null): string {
  if (value === null) return "";
  if (value >= 60) return " r5";
  if (value >= 40) return " r4";
  if (value >= 20) return " r3";
  if (value > 0) return " r2";
  return " r1";
}

export default async function AudiencePage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.analytics")) notFound();
  const locale = await getLocale();

  const [summary, steps, cohorts, active, totalUsers, newUsers] = await Promise.all([
    audience(),
    funnel(),
    retention(),
    topUsers(),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
  ]);

  const totalViews = summary.signedInViews + summary.anonymousViews;
  const first = steps[0]?.count ?? 0;

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Visitors & users", "访客与用户")}</h1>
        <p className="sub">{tr(
          locale,
          "How much of the audience is signed in, whether they come back, and where the path from reader to account breaks.",
          "有多少受众处于登录状态、他们是否回访，以及「读者 → 账户」这条路在哪一环断掉。",
        )}</p>
      </div>
      <div className="tag-row"><span className="chip gray">{tr(locale, plural(totalUsers, "account", "accounts"), `${totalUsers} 个账户`)}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Audience summary", "受众概览")}>
      <StatCard label={tr(locale, "Daily active", "日活")} value={String(summary.dau)} note={tr(locale, "signed-in accounts · 24h", "登录账户 · 24 小时")} />
      <StatCard label={tr(locale, "Weekly active", "周活")} value={String(summary.wau)} note={tr(locale, "signed-in accounts · 7d", "登录账户 · 7 天")} />
      <StatCard label={tr(locale, "Monthly active", "月活")} value={String(summary.mau)} note={tr(locale, `${newUsers} joined this month`, `本月新增 ${newUsers}`)} />
      <StatCard
        label={tr(locale, "Stickiness", "粘性")}
        value={summary.stickiness === null ? "—" : `${summary.stickiness.toFixed(0)}%`}
        note={tr(locale, "DAU / MAU", "日活 / 月活")}
      />
    </section>

    <div className="analytics-grid">
      <section className="blk">
        <div className="section-t">{tr(locale, "Reader to account", "从读者到账户")}</div>
        {/* Absolute counts and the drop between steps: a funnel drawn only as percentages
            hides that the first step may be twelve people. */}
        <div className="funnel">
          {steps.map((step, index) => {
            const previous = index === 0 ? null : steps[index - 1].count;
            const share = first === 0 ? 0 : (step.count / first) * 100;
            return <div className="funnel-step" key={step.label}>
              <span className="funnel-fill" style={{ width: `${Math.max(1, share).toFixed(1)}%` }} aria-hidden="true" />
              <span className="funnel-label">{tr(locale, ...FUNNEL_LABEL[step.label])}</span>
              <span className="funnel-value tnum">
                {compact(step.count)}
                {previous !== null && <small>{share_(step.count, previous)}</small>}
              </span>
            </div>;
          })}
        </div>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Signed in vs anonymous", "登录 vs 匿名")}</div>
        <BarList
          empty={tr(locale, "No page view in the last 30 days.", "最近 30 天没有浏览记录。")}
          total={totalViews}
          rows={[
            { label: tr(locale, "Signed in", "已登录"), value: summary.signedInViews, hint: totalViews ? `${((summary.signedInViews / totalViews) * 100).toFixed(0)}%` : undefined },
            { label: tr(locale, "Anonymous", "匿名"), value: summary.anonymousViews, hint: totalViews ? `${((summary.anonymousViews / totalViews) * 100).toFixed(0)}%` : undefined },
          ]}
        />
      </section>
    </div>

    <section className="blk">
      <div className="section-t">
        <span>{tr(locale, "Weekly retention", "周留存")}</span>
        <span className="chip gray">{tr(locale, "by signup week", "按注册周")}</span>
      </div>
      <div className="tbl-wrap"><table className="admin-table retention-table">
        <thead><tr>
          <th>{tr(locale, "Cohort", "注册周")}</th>
          <th>{tr(locale, "Size", "人数")}</th>
          {Array.from({ length: 6 }, (_, index) => <th key={index}>W{index}</th>)}
        </tr></thead>
        <tbody>
          {cohorts.length === 0 && <tr><td colSpan={8}><div className="empty-state">{tr(locale, "No account has been created in the last six weeks.", "最近六周没有新增账户。")}</div></td></tr>}
          {cohorts.map((row) => <tr key={row.cohort}>
            <td className="mono-cell">{row.cohort}</td>
            <td className="mono-cell">{row.size}</td>
            {row.weeks.map((value, index) => (
              <td key={index} className={`retention-cell${band(value)}`}>{value === null ? "" : `${value.toFixed(0)}%`}</td>
            ))}
          </tr>)}
        </tbody>
      </table></div>
      <p className="admin-hint">{tr(
        locale,
        "Returning means the account opened a page that week — not that it did anything. The weaker definition of the two, and the one that cannot flatter itself.",
        "「回访」指该账户当周打开过页面，而不是完成了什么操作 —— 两种口径里更弱、也更不会自我美化的那个。",
      )}</p>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Most active accounts · 30d", "最活跃账户 · 30 天")}</span><span className="chip gray">{active.length}</span></div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Account", "账户")}</th>
          <th>{tr(locale, "Page views", "浏览量")}</th>
          <th>{tr(locale, "Last seen", "最近活跃")}</th>
        </tr></thead>
        <tbody>
          {active.length === 0 && <tr><td colSpan={3}><div className="empty-state">{tr(locale, "No signed-in reading recorded yet.", "尚未记录到登录状态下的访问。")}</div></td></tr>}
          {active.map((row) => <tr key={row.id}>
            <td className="inst">{can(user, "admin.users")
              ? <Link href={localePath(locale, `/admin/users/${row.id}`)}>{row.email}</Link>
              : row.email}</td>
            <td className="mono-cell">{row.views.toLocaleString()}</td>
            <td className="mono-cell">{age(row.lastSeenAt, locale)}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>
  </>;
}
