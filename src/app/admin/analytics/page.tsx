import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { breakdown, events, isRange, overview, RANGES, realtime, timeseries, vitals, windowFor, type Range } from "@/lib/analytics/query";
import { BarList, Donut, StatCard, TimeSeries } from "@/app/_components/charts";
import { compact, plural } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "流量分析" };

const RANGE_LABEL: Record<Range, [string, string]> = {
  "24h": ["24 hours", "24 小时"],
  "7d": ["7 days", "7 天"],
  "30d": ["30 days", "30 天"],
  "90d": ["90 days", "90 天"],
};

function seconds(value: number | null, locale: string): string {
  if (value === null) return "—";
  if (value < 60) return `${value.toFixed(0)}s`;
  return locale === "zh-CN" ? `${Math.floor(value / 60)} 分 ${Math.round(value % 60)} 秒` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

export default async function TrafficPage(props: { searchParams: Promise<{ range?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.analytics")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const range: Range = isRange(params.range) ? params.range : "7d";
  const window = windowFor(range);

  const [stats, series, live, pages, referrers, countries, devices, browsers, systems, locales, campaigns, eventRows, vitalRows] = await Promise.all([
    overview(window),
    timeseries(window),
    realtime(),
    breakdown("path", window, 12),
    breakdown("referrerHost", window, 10),
    breakdown("country", window, 10),
    breakdown("device", window, 4),
    breakdown("browser", window, 8),
    breakdown("os", window, 8),
    breakdown("locale", window, 4),
    breakdown("utmSource", window, 8),
    events(window),
    vitals(window),
  ]);

  const empty = tr(locale, "Nothing recorded in this period.", "该时段没有记录。");

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Traffic", "流量")}</h1>
        <p className="sub">{tr(
          locale,
          "First-party and cookie-less. Visitors are counted by a digest that rotates every day, so nobody is followed from one day to the next.",
          "自建统计，不使用 Cookie。访客身份摘要每日轮换，因此不会跨天追踪任何人。",
        )}</p>
      </div>
      <div className="tag-row">
        <span className="chip bull" title={tr(locale, "Active in the last 30 minutes", "最近 30 分钟活跃")}>
          ● {live.visitors} {tr(locale, "online", "在线")}
        </span>
      </div>
    </header>

    <div className="admin-filter-row">
      {RANGES.map((option) => (
        <a key={option} className={`minibtn${option === range ? " p" : ""}`} href={`?range=${option}`}>{tr(locale, ...RANGE_LABEL[option])}</a>
      ))}
    </div>

    <section className="admin-stats" aria-label={tr(locale, "Traffic summary", "流量概览")}>
      <StatCard label={tr(locale, "Visitors", "访客")} value={compact(stats.visitors)} change={stats.visitorsChange} note={tr(locale, "vs previous period", "较上期")} />
      <StatCard label={tr(locale, "Page views", "浏览量")} value={compact(stats.views)} change={stats.viewsChange} note={tr(locale, "vs previous period", "较上期")} />
      <StatCard label={tr(locale, "Bounce rate", "跳出率")} value={stats.bounceRate === null ? "—" : `${stats.bounceRate.toFixed(0)}%`} note={tr(locale, plural(stats.sessions, "session", "sessions"), `${stats.sessions} 次会话`)} />
      <StatCard label={tr(locale, "Time on page", "页面停留")} value={seconds(stats.avgDurationSec, locale)} note={tr(locale, "average, measured", "实测平均值")} />
    </section>

    <section className="blk">
      <div className="section-t">
        <span>{tr(locale, "Views and visitors", "浏览量与访客")}</span>
        <span className="chip gray">{range === "24h" ? tr(locale, "hourly, UTC", "按小时 · UTC") : tr(locale, "daily, UTC", "按天 · UTC")}</span>
      </div>
      <TimeSeries points={series} primaryLabel={tr(locale, "Views", "浏览量")} secondaryLabel={tr(locale, "Visitors", "访客")} />
    </section>

    <div className="analytics-grid">
      <section className="blk">
        <div className="section-t">{tr(locale, "Top pages", "热门页面")}</div>
        <BarList empty={empty} rows={pages.map((row) => ({
          label: row.value,
          value: row.views,
          hint: tr(locale, plural(row.visitors, "visitor", "visitors"), `${row.visitors} 访客`),
          href: localePath(locale, row.value),
        }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Referrers", "来源站点")}</div>
        <BarList empty={tr(locale, "Every visit in this period arrived directly.", "该时段全部为直接访问。")} rows={referrers.map((row) => ({
          label: row.value,
          value: row.views,
          hint: tr(locale, plural(row.visitors, "visitor", "visitors"), `${row.visitors} 访客`),
        }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Countries", "国家 / 地区")}</div>
        <BarList empty={tr(locale, "No country was attached by the network edge.", "网络边缘未附带国家信息。")} rows={countries.map((row) => ({ label: row.value, value: row.views }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Devices", "设备")}</div>
        {devices.length === 0 ? <div className="empty-state">{empty}</div> : <Donut slices={devices.map((row) => ({ label: row.value, value: row.views }))} />}
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Browsers", "浏览器")}</div>
        <BarList empty={empty} rows={browsers.map((row) => ({ label: row.value, value: row.views }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Operating systems", "操作系统")}</div>
        <BarList empty={empty} rows={systems.map((row) => ({ label: row.value, value: row.views }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Language", "语言")}</div>
        <BarList empty={empty} rows={locales.map((row) => ({ label: row.value === "zh-CN" ? tr(locale, "Chinese", "中文") : tr(locale, "English", "英文"), value: row.views }))} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Campaigns", "推广活动")}</div>
        <BarList empty={tr(locale, "No visit in this period carried a utm_source.", "该时段没有带 utm_source 的访问。")} rows={campaigns.map((row) => ({
          label: row.value,
          value: row.views,
          hint: tr(locale, plural(row.visitors, "visitor", "visitors"), `${row.visitors} 访客`),
        }))} />
      </section>
    </div>

    <div className="admin-columns">
      <section className="blk">
        <div className="section-t"><span>{tr(locale, "Actions", "行为事件")}</span><span className="chip gray">{eventRows.length}</span></div>
        <div className="tbl-wrap"><table className="admin-table">
          <thead><tr>
            <th>{tr(locale, "Event", "事件")}</th>
            <th>{tr(locale, "Count", "次数")}</th>
            <th>{tr(locale, "Visitors", "触发访客")}</th>
            <th>{tr(locale, "Per visitor", "人均")}</th>
          </tr></thead>
          <tbody>
            {eventRows.length === 0 && <tr><td colSpan={4}><div className="empty-state">{empty}</div></td></tr>}
            {eventRows.map((row) => <tr key={row.name}>
              <td className="inst"><b>{row.name}</b></td>
              <td className="mono-cell">{row.count.toLocaleString()}</td>
              <td className="mono-cell">{row.visitors.toLocaleString()}</td>
              <td className="mono-cell">{(row.count / Math.max(1, row.visitors)).toFixed(1)}</td>
            </tr>)}
          </tbody>
        </table></div>
      </section>

      <aside>
        <section className="blk">
          <div className="section-t">{tr(locale, "Right now", "此刻")}</div>
          <div className="admin-panel">
            <div className="realtime-head"><b className="tnum">{live.visitors}</b><span>{tr(locale, "visitors · last 30 min", "访客 · 最近 30 分钟")}</span></div>
            <BarList empty={tr(locale, "Nobody is on the site.", "当前没有访客。")} rows={live.pages.map((page) => ({ label: page.path, value: page.views }))} />
          </div>
        </section>

        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Web vitals", "页面体验")}</span>
            <span className="chip gray">p75</span>
          </div>
          <div className="vitals">
            {vitalRows.length === 0 && <div className="empty-state">{tr(locale, "No measurement has arrived yet.", "尚未收到任何测量数据。")}</div>}
            {vitalRows.map((vital) => <div className={`vital vital-${vital.rating}`} key={vital.metric}>
              <span>{vital.metric}</span>
              <b className="tnum">{vital.metric === "CLS" ? vital.p75.toFixed(2) : `${Math.round(vital.p75)}ms`}</b>
              <small>{tr(locale, plural(vital.samples, "sample", "samples"), `${vital.samples} 个样本`)}</small>
            </div>)}
          </div>
        </section>
      </aside>
    </div>
  </>;
}
