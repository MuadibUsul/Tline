import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr, localePath, type Locale } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { isRange, RANGES, windowFor, type Range } from "@/lib/analytics/query";
import { botTraffic } from "@/lib/analytics/bots";
import { BarList, StatCard } from "@/app/_components/charts";
import { compact, age } from "../../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "机器人流量" };

const RANGE_LABEL: Record<Range, [string, string]> = {
  "24h": ["24 hours", "24 小时"],
  "7d": ["7 days", "7 天"],
  "30d": ["30 days", "30 天"],
  "90d": ["90 days", "90 天"],
  "180d": ["180 days", "180 天"],
};

function classLabel(value: string, locale: Locale): string {
  switch (value) {
    case "crawler": return tr(locale, "Crawler", "爬虫");
    case "ai_agent": return tr(locale, "AI agent", "AI Agent");
    case "automation": return tr(locale, "Automation", "自动化");
    default: return tr(locale, "Unknown", "未知");
  }
}

export default async function BotTrafficPage(props: { searchParams: Promise<{ range?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.analytics")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const range: Range = isRange(params.range) ? params.range : "30d";
  const window = windowFor(range);
  const traffic = await botTraffic(window);
  const byClass = new Map(traffic.byClass.map((row) => [row.trafficClass, row.count]));
  const daily = traffic.daily.filter((row) => row.total > 0).slice(-30);

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Bot traffic", "机器人流量")}</h1>
        <p className="sub">{tr(
          locale,
          "Crawlers, AI agents and browser automation, kept out of the human page-view numbers. Counts are requests, not visitors; server renders catch agents that never execute JavaScript.",
          "爬虫、AI Agent 和浏览器自动化，不混入真人浏览量。这里是请求数而不是访客数；服务端渲染也能捕捉不执行 JavaScript 的 Agent。",
        )}</p>
      </div>
      <div className="tag-row">
        <a className="chip gray" href={localePath(locale, "/admin/analytics/behavior")}>{tr(locale, "Human behavior →", "真人行为 →")}</a>
        <span className="chip gray">{range}</span>
      </div>
    </header>

    <div className="admin-filter-row">
      {RANGES.map((option) => (
        <a key={option} className={`minibtn${option === range ? " p" : ""}`} href={`?range=${option}`}>{tr(locale, ...RANGE_LABEL[option])}</a>
      ))}
    </div>

    <section className="admin-stats" aria-label={tr(locale, "Bot traffic summary", "机器人流量概览")}>
      <StatCard label={tr(locale, "Non-human requests", "非真人请求")} value={compact(traffic.total)} note={tr(locale, `${compact(traffic.humanViews)} human views`, `${compact(traffic.humanViews)} 真人浏览`)} />
      <StatCard label={tr(locale, "Crawlers", "爬虫")} value={compact(byClass.get("crawler") ?? 0)} note={tr(locale, "search and preview", "搜索与预览")} />
      <StatCard label={tr(locale, "AI agents", "AI Agent")} value={compact(byClass.get("ai_agent") ?? 0)} note={tr(locale, "assistants and training", "助手与训练抓取")} />
      <StatCard label={tr(locale, "Automation", "自动化")} value={compact(byClass.get("automation") ?? 0)} note={tr(locale, "headless and HTTP clients", "无头浏览器与 HTTP 客户端")} />
      <StatCard label={tr(locale, "Agents", "Agent 数量")} value={String(traffic.agentsCount)} note={tr(locale, "distinct names", "不同标识")} />
      <StatCard label={tr(locale, "No-JS / JS", "无 JS / 有 JS")} value={`${compact(traffic.server)} / ${compact(traffic.beacon)}`} note={tr(locale, "server / beacon", "服务端 / beacon")} />
    </section>

    <div className="analytics-grid">
      <section className="blk">
        <div className="section-t">{tr(locale, "Requests by class", "按类型")}</div>
        <BarList
          empty={tr(locale, "No non-human request recorded.", "没有记录到非真人请求。")}
          rows={traffic.byClass.map((row) => ({ label: classLabel(row.trafficClass, locale), value: row.count }))}
        />
      </section>
      <section className="blk">
        <div className="section-t">{tr(locale, "Daily requests", "每日请求")}</div>
        <BarList
          empty={tr(locale, "No daily requests recorded.", "没有每日请求记录。")}
          rows={daily.map((row) => ({
            label: row.label,
            value: row.total,
            hint: `C ${row.crawler} · AI ${row.ai_agent} · Auto ${row.automation}`,
          }))}
        />
      </section>
    </div>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Agents", "Agent 明细")}</span><span className="chip gray">{traffic.agents.length}</span></div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Agent", "Agent")}</th>
          <th>{tr(locale, "Class", "类型")}</th>
          <th>{tr(locale, "Source", "来源")}</th>
          <th>{tr(locale, "Requests", "请求")}</th>
          <th>{tr(locale, "Last seen", "最近出现")}</th>
        </tr></thead>
        <tbody>
          {traffic.agents.length === 0 && <tr><td colSpan={5}><div className="empty-state">{tr(locale, "No agent has been recorded in this period.", "该时段没有记录到 Agent。")}</div></td></tr>}
          {traffic.agents.map((row) => <tr key={`${row.trafficClass}:${row.agentName}:${row.source}`}>
            <td className="inst">{row.agentName}</td>
            <td className="mono-cell">{classLabel(row.trafficClass, locale)}</td>
            <td className="mono-cell">{row.source === "server" ? tr(locale, "server", "服务端") : "beacon"}</td>
            <td className="mono-cell">{row.count}</td>
            <td className="mono-cell">{age(row.lastAt, locale)}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>

    <section className="blk">
      <div className="section-t">{tr(locale, "Most requested paths", "请求最多的页面")}</div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr><th>{tr(locale, "Path", "路径")}</th><th>{tr(locale, "Class", "类型")}</th><th>{tr(locale, "Requests", "请求")}</th></tr></thead>
        <tbody>
          {traffic.paths.length === 0 && <tr><td colSpan={3}><div className="empty-state">{tr(locale, "No path recorded.", "没有路径记录。")}</div></td></tr>}
          {traffic.paths.map((row) => <tr key={`${row.path}:${row.trafficClass}`}>
            <td className="mono-cell">{row.path}</td>
            <td>{classLabel(row.trafficClass, locale)}</td>
            <td className="mono-cell">{row.count}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>
  </>;
}
