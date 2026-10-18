import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr, localePath, type Locale } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { isRange, RANGES, windowFor, type Range } from "@/lib/analytics/query";
import {
  behaviorOverview, clickTargets, loyalAnonymous, pageFlow, pagePerformance, scrollDistribution, sectionHeat, trafficQuality,
} from "@/lib/analytics/behavior";
import { BarList, StatCard } from "@/app/_components/charts";
import { compact } from "../../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "行为分析" };

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

function classLabel(value: string, locale: Locale): string {
  switch (value) {
    case "human": return tr(locale, "Human", "真人");
    case "crawler": return tr(locale, "Crawler", "爬虫");
    case "ai_agent": return tr(locale, "AI agent", "AI Agent");
    case "automation": return tr(locale, "Automation", "自动化");
    default: return tr(locale, "Unknown", "未知");
  }
}

export default async function BehaviorPage(props: { searchParams: Promise<{ range?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.analytics")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const range: Range = isRange(params.range) ? params.range : "30d";
  const window = windowFor(range);

  const [overview, pages, scroll, sections, clicks, flow, loyal, quality] = await Promise.all([
    behaviorOverview(window),
    pagePerformance(window, 30),
    scrollDistribution(window),
    sectionHeat(window, 30),
    clickTargets(window, 25),
    pageFlow(window, 20),
    loyalAnonymous(window),
    trafficQuality(window, 20),
  ]);

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Behavior", "行为分析")}</h1>
        <p className="sub">{tr(
          locale,
          "What people read, where they stop, what they click, and which visitors come back without an account. Human page views only; the bot/agent lane is separate.",
          "读者读到哪里、在哪里停下、点了什么，以及哪些访客反复回来但没有注册。这里只统计真人浏览；爬虫与 Agent 单独展示。",
        )}</p>
      </div>
      <div className="tag-row"><span className="chip gray">{range}</span></div>
    </header>

    <div className="admin-filter-row">
      {RANGES.map((option) => (
        <a key={option} className={`minibtn${option === range ? " p" : ""}`} href={`?range=${option}`}>{tr(locale, ...RANGE_LABEL[option])}</a>
      ))}
    </div>

    <section className="admin-stats" aria-label={tr(locale, "Behavior summary", "行为概览")}>
      <StatCard label={tr(locale, "Page views", "浏览量")} value={compact(overview.views)} note={tr(locale, `${compact(overview.visitors)} visitors`, `${compact(overview.visitors)} 访客`)} />
      <StatCard label={tr(locale, "Glance rate", "扫一眼就走")} value={percent(overview.glanceRate)} note={tr(locale, `${overview.glances} views under 5s`, `${overview.glances} 次少于 5 秒`)} />
      <StatCard label={tr(locale, "Read rate", "阅读率")} value={percent(overview.readRate)} note={tr(locale, `${overview.reads} reads`, `${overview.reads} 次有效阅读`)} />
      <StatCard label={tr(locale, "Median read", "中位停留")} value={seconds(overview.medianVisibleSec)} note={tr(locale, "visible time", "可见时长")} />
      <StatCard label={tr(locale, "Anonymous loyal", "匿名忠诚访客")} value={String(loyal.visitors)} note={tr(locale, `≥${loyal.thresholdDays} days, no account`, `≥${loyal.thresholdDays} 天，未注册`)} />
      <StatCard label={tr(locale, "Bot / agent requests", "爬虫 / Agent 请求")} value={compact(quality.botHits)} note={tr(locale, `${compact(quality.humanViews)} human views`, `${compact(quality.humanViews)} 真人浏览`)} />
    </section>

    <section className="blk">
      <div className="section-t">{tr(locale, "Page performance", "页面表现")}</div>
        <div className="tbl-wrap"><table className="admin-table">
          <thead><tr>
            <th>{tr(locale, "Page", "页面")}</th>
            <th>{tr(locale, "Views", "浏览")}</th>
            <th>{tr(locale, "Glance", "扫一眼")}</th>
            <th>{tr(locale, "Read", "阅读")}</th>
            <th>{tr(locale, "Median", "中位停留")}</th>
            <th>{tr(locale, "Scroll", "滚动")}</th>
            <th>{tr(locale, "Exit", "退出")}</th>
          </tr></thead>
          <tbody>
            {pages.length === 0 && <tr><td colSpan={7}><div className="empty-state">{tr(locale, "No human page views in this period.", "该时段没有真人浏览记录。")}</div></td></tr>}
            {pages.map((row) => <tr key={row.path}>
              <td className="inst"><a href={localePath(locale, row.path)}>{row.path}</a><small className="admin-hint">{row.template ?? "—"}</small></td>
              <td className="mono-cell">{row.views}</td>
              <td className="mono-cell">{percent(row.glanceRate)}</td>
              <td className="mono-cell">{percent(row.readRate)}</td>
              <td className="mono-cell">{seconds(row.medianVisibleSec)}</td>
              <td className="mono-cell">{percent(row.medianScrollPct)}</td>
              <td className="mono-cell">{percent(row.exitRate)}</td>
            </tr>)}
          </tbody>
        </table></div>
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

    <div className="analytics-grid">
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

      <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "Traffic quality", "流量质量")}</span>
          <span className="chip gray">{tr(locale, "human vs bot", "真人 vs 非真人")}</span>
        </div>
        <BarList
          empty={tr(locale, "No non-human requests recorded.", "没有记录到非真人请求。")}
          rows={quality.agents.map((row) => ({ label: `${classLabel(row.trafficClass, locale)} · ${row.agentName}`, value: row.count }))}
        />
      </section>
    </div>

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

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Crawler / agent paths", "爬虫 / Agent 路径")}</span><span className="chip gray">{quality.byClass.map((row) => `${classLabel(row.trafficClass, locale)} ${compact(row.count)}`).join(" · ")}</span></div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr><th>{tr(locale, "Path", "路径")}</th><th>{tr(locale, "Class", "类型")}</th><th>{tr(locale, "Requests", "请求")}</th></tr></thead>
        <tbody>
          {quality.paths.length === 0 && <tr><td colSpan={3}><div className="empty-state">{tr(locale, "No crawler or agent request recorded.", "没有记录到爬虫或 Agent 请求。")}</div></td></tr>}
          {quality.paths.map((row) => <tr key={`${row.path}:${row.trafficClass}`}><td className="mono-cell">{row.path}</td><td>{classLabel(row.trafficClass, locale)}</td><td className="mono-cell">{row.count}</td></tr>)}
        </tbody>
      </table></div>
      <p className="admin-hint">{tr(
        locale,
        "Non-human requests are requests, not visitors. Server renders catch crawlers that never run JavaScript; beacons catch JS-capable agents. Neither stores an IP.",
        "非真人数字是请求数，不是访客数。服务端渲染捕捉不执行 JavaScript 的爬虫，beacon 捕捉能执行 JS 的 Agent；两者都不保存 IP。",
      )}</p>
    </section>
  </>;
}
