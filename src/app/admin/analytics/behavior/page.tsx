import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { isRange, RANGES, windowFor, type Range } from "@/lib/analytics/query";
import {
  behaviorOverview, clickTargets, loyalAnonymous, pageFlow, pagePerformance, scrollDistribution, sectionHeat,
} from "@/lib/analytics/behavior";
import { BarList, StatCard } from "@/app/_components/charts";
import { compact } from "../../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "真人行为" };

const RANGE_LABEL: Record<Range, [string, string]> = {
  "24h": ["24 hours", "24 小时"],
  "7d": ["7 days", "7 天"],
  "30d": ["30 days", "30 天"],
  "90d": ["90 days", "90 天"],
  "180d": ["180 days", "180 天"],
};

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(0)}%`;
}

function seconds(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

export default async function BehaviorPage(props: { searchParams: Promise<{ range?: string; page?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.analytics")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const range: Range = isRange(params.range) ? params.range : "30d";
  const requestedPage = Math.max(1, Math.round(Number(params.page) || 1));
  const window = windowFor(range);

  const [overview, performance, scroll, sections, clicks, flow, loyal] = await Promise.all([
    behaviorOverview(window),
    pagePerformance(window, requestedPage, 5),
    scrollDistribution(window),
    sectionHeat(window, 30),
    clickTargets(window, 25),
    pageFlow(window, 20),
    loyalAnonymous(window),
  ]);

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Human behavior", "真人行为")}</h1>
        <p className="sub">{tr(
          locale,
          "What real readers read, where they stop, what they click, and which visitors come back without an account. Crawlers, AI agents and automation are managed on their own page.",
          "真人读者读到哪里、在哪里停下、点了什么，以及哪些访客反复回来但没有注册。爬虫、AI Agent 和自动化流量在独立页面管理。",
        )}</p>
      </div>
      <div className="tag-row">
        <a className="chip gray" href={localePath(locale, "/admin/analytics/bots")}>{tr(locale, "Bot traffic →", "机器人流量 →")}</a>
        <span className="chip gray">{range}</span>
      </div>
    </header>

    <div className="admin-filter-row">
      {RANGES.map((option) => (
        <a key={option} className={`minibtn${option === range ? " p" : ""}`} href={`?range=${option}`}>{tr(locale, ...RANGE_LABEL[option])}</a>
      ))}
    </div>

    <section className="admin-stats" aria-label={tr(locale, "Behavior summary", "行为概览")}>
      <StatCard label={tr(locale, "Page views", "浏览量")} value={compact(overview.views)} note={tr(locale, `${compact(overview.visitors)} visitors`, `${compact(overview.visitors)} 访客`)} />
      <StatCard label={tr(locale, "Glance rate", "扫一眼就走")} value={percent(overview.glanceRate)} note={tr(locale, `${overview.glances} of ${overview.measured} measured`, `${overview.glances} / ${overview.measured} 条行为样本`)} />
      <StatCard label={tr(locale, "Read rate", "阅读率")} value={percent(overview.readRate)} note={tr(locale, `${overview.reads} of ${overview.measured} measured`, `${overview.reads} / ${overview.measured} 条行为样本`)} />
      <StatCard label={tr(locale, "Median read", "中位停留")} value={seconds(overview.medianVisibleSec)} note={tr(locale, "visible time", "可见时长")} />
      <StatCard label={tr(locale, "Anonymous loyal", "匿名忠诚访客")} value={String(loyal.visitors)} note={tr(locale, `≥${loyal.thresholdDays} days, no account`, `≥${loyal.thresholdDays} 天，未注册`)} />
      <StatCard label={tr(locale, "Clicks", "点击")} value={compact(overview.clickEvents)} note={tr(locale, "human clicks", "真人点击")} />
    </section>
    <p className="admin-hint" style={{ marginTop: 8 }}>
      {tr(
        locale,
        `Rates use ${overview.measured} views with behavior data. Older page views only have views and time; they are counted in views and visitors but not in glance/read rates.`,
        `比例按 ${overview.measured} 条有行为数据的浏览计算。旧浏览只有浏览量和时间，仍计入浏览量/访客，但不参与扫一眼和阅读率。`,
      )}
    </p>

    <section className="blk">
      <div className="section-t">{tr(locale, "Page performance", "页面表现")}</div>
        <div className="tbl-wrap"><table className="admin-table">
          <thead><tr>
            <th>{tr(locale, "Page", "页面")}</th>
            <th>{tr(locale, "Views", "浏览")}</th>
            <th>{tr(locale, "Measured", "样本")}</th>
            <th>{tr(locale, "Glance", "扫一眼")}</th>
            <th>{tr(locale, "Read", "阅读")}</th>
            <th>{tr(locale, "Median", "中位停留")}</th>
            <th>{tr(locale, "Scroll", "滚动")}</th>
            <th>{tr(locale, "Exit", "退出")}</th>
          </tr></thead>
          <tbody>
            {performance.rows.length === 0 && <tr><td colSpan={8}><div className="empty-state">{tr(locale, "No human page views in this period.", "该时段没有真人浏览记录。")}</div></td></tr>}
            {performance.rows.map((row) => <tr key={row.path}>
              <td className="inst"><a href={localePath(locale, row.path)}>{row.path}</a><small className="admin-hint">{row.template ?? "—"}</small></td>
              <td className="mono-cell">{row.views}</td>
              <td className="mono-cell">{row.measured}</td>
              <td className="mono-cell">{percent(row.glanceRate)}</td>
              <td className="mono-cell">{percent(row.readRate)}</td>
              <td className="mono-cell">{seconds(row.medianVisibleSec)}</td>
              <td className="mono-cell">{percent(row.medianScrollPct)}</td>
              <td className="mono-cell">{percent(row.exitRate)}</td>
            </tr>)}
          </tbody>
        </table></div>
        {performance.pages > 1 && (
          <div className="admin-filter-row" style={{ justifyContent: "flex-end", alignItems: "center", marginTop: 10 }}>
            {performance.page > 1 && <a className="minibtn" href={`?range=${range}&page=${performance.page - 1}`}>{tr(locale, "Previous", "上一页")}</a>}
            <span className="chip gray">{performance.page} / {performance.pages}</span>
            {performance.page < performance.pages && <a className="minibtn" href={`?range=${range}&page=${performance.page + 1}`}>{tr(locale, "Next", "下一页")}</a>}
            <span className="admin-hint">{tr(locale, `${performance.total} pages`, `${performance.total} 个页面`)}</span>
          </div>
        )}
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Scroll depth", "滚动深度")}</div>
        <BarList
          empty={tr(locale, "No scroll measurements yet.", "尚未收到滚动数据。")}
          total={scroll.reduce((total, bucket) => total + bucket.views, 0)}
          rows={scroll.map((bucket) => ({ label: bucket.label, value: bucket.views, hint: bucket.share === null ? undefined : `${bucket.share.toFixed(0)}%` }))}
        />
    </section>

    <section className="blk">
      <div className="section-t">
        <span>{tr(locale, "Section attention", "区块注意力")}</span>
        <span className="chip gray">{tr(locale, "where they stayed / left", "停留与退出位置")}</span>
      </div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Page", "页面")}</th>
          <th>{tr(locale, "Section", "区块")}</th>
          <th>{tr(locale, "Views", "曝光")}</th>
          <th>{tr(locale, "Avg visible", "平均可见")}</th>
          <th>{tr(locale, "Max visible", "最大可见")}</th>
          <th>{tr(locale, "Exit", "退出")}</th>
        </tr></thead>
        <tbody>
          {sections.length === 0 && <tr><td colSpan={6}><div className="empty-state">{tr(locale, "No section attention yet.", "尚未收到区块注意力数据。")}</div></td></tr>}
          {sections.map((row) => <tr key={`${row.path}:${row.section}`}>
            <td className="mono-cell">{row.path}</td>
            <td className="inst">{row.title ?? row.section}</td>
            <td className="mono-cell">{row.views}</td>
            <td className="mono-cell">{seconds(row.avgVisibleSec)}</td>
            <td className="mono-cell">{percent(row.maxVisiblePct)}</td>
            <td className="mono-cell">{percent(row.exitRate)}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <section className="blk">
      <div className="section-t">{tr(locale, "Anonymous loyal readers", "匿名忠诚读者")}</div>
      <BarList
        empty={tr(locale, "No stable-cookie reader has reached the threshold yet.", "还没有稳定 Cookie 访客达到阈值。")}
        rows={loyal.topPages.map((row) => ({ label: row.path, value: row.views, href: localePath(locale, row.path) }))}
      />
      <p className="admin-hint">{tr(
        locale,
        "This segment requires the analytics cookie. Readers who declined it are counted in the aggregate but cannot appear here.",
        "这个人群需要分析 Cookie。拒绝 Cookie 的读者仍计入汇总，但不会出现在这里。",
      )}</p>
    </section>

    <div className="analytics-grid">
      <section className="blk">
        <div className="section-t">{tr(locale, "Clicked targets", "点击目标")}</div>
        <div className="tbl-wrap"><table className="admin-table">
          <thead><tr><th>{tr(locale, "Page", "页面")}</th><th>{tr(locale, "Target", "目标")}</th><th>{tr(locale, "Type", "类型")}</th><th>{tr(locale, "Clicks", "点击")}</th></tr></thead>
          <tbody>
            {clicks.length === 0 && <tr><td colSpan={4}><div className="empty-state">{tr(locale, "No clicks recorded yet.", "尚未记录到点击。")}</div></td></tr>}
            {clicks.map((row, index) => <tr key={`${row.path}:${row.targetPath ?? row.label ?? index}`}>
              <td className="mono-cell">{row.path}</td>
              <td className="inst">{row.label ?? row.targetPath ?? "—"}</td>
              <td className="mono-cell">{row.type}</td>
              <td className="mono-cell">{row.count}</td>
            </tr>)}
          </tbody>
        </table></div>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Page flow", "页面流转")}</div>
        <div className="tbl-wrap"><table className="admin-table">
          <thead><tr><th>{tr(locale, "From", "从")}</th><th>{tr(locale, "To", "到")}</th><th>{tr(locale, "Count", "次数")}</th></tr></thead>
          <tbody>
            {flow.length === 0 && <tr><td colSpan={3}><div className="empty-state">{tr(locale, "No next-page transitions yet.", "尚未记录到页面流转。")}</div></td></tr>}
            {flow.map((row) => <tr key={`${row.from}->${row.to}`}><td className="mono-cell">{row.from}</td><td className="mono-cell">{row.to}</td><td className="mono-cell">{row.count}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </div>

  </>;
}
