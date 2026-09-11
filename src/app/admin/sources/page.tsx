import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { queueSourceRetry, setSourceMonitoring } from "../actions";
import { adminLabel, age, tone } from "../_components/format";
import { pipelineHealth } from "@/lib/pipelineHealth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "来源与爬虫" };

export default async function SourcesPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.sources")) notFound();
  const locale = await getAdminLocale();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [sources, articles24h, articles7d, health] = await Promise.all([
    prisma.institution.findMany({ orderBy: [{ monitoringEnabled: "desc" }, { priority: "asc" }, { name: "asc" }] }),
    prisma.article.count({ where: { createdAt: { gte: since } } }),
    prisma.article.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    pipelineHealth(),
  ]);

  const enabled = sources.filter((source) => source.monitoringEnabled && ["allowed", "delayed"].includes(source.crawlPolicy)).length;
  const unhealthy = sources.filter((source) => ["failed", "refused", "paused"].includes(source.lastCrawlStatus ?? "") || (!source.monitoringEnabled && source.consecutiveFailures > 0)).length;
  const blocked = sources.filter((source) => !["allowed", "delayed"].includes(source.crawlPolicy)).length;

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Sources & crawler", "来源与爬虫")}</h1>
        <p className="sub">{tr(locale, "Which publishers are being watched, whether the last pass worked, and what the robots audit permits.", "监控哪些出版方、最近一轮抓取是否成功，以及 robots 审计允许做什么。")}</p>
      </div>
      <div className="tag-row"><span className="chip acc">{enabled} {tr(locale, "monitored", "监控中")}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Source summary", "来源概览")}>
      <div className="admin-stat"><span>{tr(locale, "Monitored sources", "监控来源")}</span><b>{enabled}</b><small>{sources.length} total · {blocked} {tr(locale, "not crawlable", "不可抓取")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "New research · 24h", "24 小时新增研报")}</span><b>{articles24h}</b><small>{articles7d} / 7d</small></div>
      <div className="admin-stat"><span>{tr(locale, "Unhealthy", "异常来源")}</span><b>{unhealthy}</b><small>{tr(locale, "failed, refused or circuit-open", "失败、被拒或熔断")}</small></div>
      {/* A pipeline that succeeds while bringing nothing back reports as healthy
          everywhere else; this is the one place it shows. */}
      <div className={`admin-stat${health.stalled.length ? " admin-stat-alarm" : ""}`}>
        <span>{tr(locale, "Newest research", "最近入库")}</span>
        <b>{health.articleAgeHours === null ? "—" : health.articleAgeHours < 1 ? tr(locale, "<1h", "1 小时内") : `${health.articleAgeHours.toFixed(0)}h`}</b>
        <small>{health.stalled.length ? health.stalled.join(" · ") : tr(locale, `${health.workingSources}/${health.crawlableSources} sources succeeded / 24h`, `24 小时内 ${health.workingSources}/${health.crawlableSources} 家来源成功`)}</small>
      </div>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Source monitoring", "来源监控")}</span><span className="chip gray">{sources.length}</span></div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Institution", "机构")}</th>
          <th>{tr(locale, "Status", "状态")}</th>
          <th>{tr(locale, "Last success", "最近成功")}</th>
          <th>{tr(locale, "Policy", "合规策略")}</th>
          <th>{tr(locale, "Action", "操作")}</th>
        </tr></thead>
        <tbody>{sources.map((source) => {
          const compliant = ["allowed", "delayed"].includes(source.crawlPolicy);
          return <tr key={source.id}>
            <td className="inst">
              <Link href={localePath(locale, `/institution/${source.slug}`)}>{source.name}</Link>
              <small>{source.updateFreq ?? "—"}</small>
            </td>
            <td>
              <span className={`chip ${tone(source.lastCrawlStatus)}`}>{adminLabel(source.monitoringEnabled ? source.lastCrawlStatus ?? "new" : source.consecutiveFailures > 0 ? "circuit_open" : "paused")}</span>
              {source.lastCrawlMessage && <small title={source.lastCrawlMessage}>{source.consecutiveFailures ? `${source.consecutiveFailures}× · ` : ""}{source.lastCrawlMessage}</small>}
            </td>
            <td className="mono-cell">{age(source.lastSuccessAt, locale)}</td>
            <td><span className={`chip ${compliant ? "gray" : "bear"}`}>{adminLabel(source.crawlPolicy)}</span></td>
            <td><div className="admin-actions">{compliant && <>
              <form action={setSourceMonitoring}>
                <input type="hidden" name="id" value={source.id} />
                <input type="hidden" name="enabled" value={source.monitoringEnabled ? "false" : "true"} />
                <button className="minibtn" type="submit">{source.monitoringEnabled ? tr(locale, "Pause", "暂停") : tr(locale, "Resume", "恢复")}</button>
              </form>
              {["failed", "paused"].includes(source.lastCrawlStatus ?? "") && <form action={queueSourceRetry}>
                <input type="hidden" name="id" value={source.id} />
                <button className="minibtn p" type="submit">{tr(locale, "Next run", "加入下一轮")}</button>
              </form>}
            </>}</div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </>;
}
