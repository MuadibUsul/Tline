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

type SourceFilter = "monitored" | "new" | "unhealthy" | "recent";
const SOURCE_FILTERS = new Set<SourceFilter>(["monitored", "new", "unhealthy", "recent"]);

export default async function SourcesPage(props: { searchParams: Promise<{ filter?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.sources")) notFound();
  const locale = await getAdminLocale();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const requestedFilter = (await props.searchParams).filter as SourceFilter | undefined;
  const filter = requestedFilter && SOURCE_FILTERS.has(requestedFilter) ? requestedFilter : undefined;

  const [sources, articles24h, articles7d, recentInstitutions, health] = await Promise.all([
    prisma.institution.findMany({ orderBy: [{ monitoringEnabled: "desc" }, { priority: "asc" }, { name: "asc" }] }),
    prisma.article.count({ where: { createdAt: { gte: since } } }),
    prisma.article.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.article.findMany({ where: { createdAt: { gte: since } }, distinct: ["institutionId"], select: { institutionId: true } }),
    pipelineHealth(),
  ]);

  const isMonitored = (source: typeof sources[number]) => source.monitoringEnabled && ["allowed", "delayed"].includes(source.crawlPolicy);
  const isUnhealthy = (source: typeof sources[number]) => ["failed", "refused", "paused"].includes(source.lastCrawlStatus ?? "") || (!source.monitoringEnabled && source.consecutiveFailures > 0);
  const recentInstitutionIds = new Set(recentInstitutions.map((row) => row.institutionId));
  const enabled = sources.filter(isMonitored).length;
  const unhealthy = sources.filter(isUnhealthy).length;
  const blocked = sources.filter((source) => !["allowed", "delayed"].includes(source.crawlPolicy)).length;
  const visibleSources = sources.filter((source) => !filter
    || filter === "monitored" && isMonitored(source)
    || filter === "new" && recentInstitutionIds.has(source.id)
    || filter === "unhealthy" && isUnhealthy(source)
    || filter === "recent" && Boolean(source.lastSuccessAt && source.lastSuccessAt >= since));
  const filterLabels: Record<SourceFilter, string> = {
    monitored: tr(locale, "Monitored sources", "监控来源"),
    new: tr(locale, "New research · 24h", "24 小时新增研报"),
    unhealthy: tr(locale, "Unhealthy", "异常来源"),
    recent: tr(locale, "Succeeded · 24h", "24 小时内成功"),
  };
  const filterHref = (key: SourceFilter) => localePath(locale, `/admin/sources${filter === key ? "" : `?filter=${key}`}`);

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Sources & crawler", "来源与爬虫")}</h1>
        <p className="sub">{tr(locale, "Which publishers are being watched, whether the last pass worked, and what the robots audit permits.", "监控哪些出版方、最近一轮抓取是否成功，以及 robots 审计允许做什么。")}</p>
      </div>
      <div className="tag-row"><span className="chip acc">{enabled} {tr(locale, "monitored", "监控中")}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Source summary", "来源概览")}>
      <Link className="admin-stat admin-stat-filter" aria-current={filter === "monitored" ? "true" : undefined} href={filterHref("monitored")} title={tr(locale, "Filter monitored sources", "筛选监控中的来源")}><span>{tr(locale, "Monitored sources", "监控来源")}</span><b>{enabled}</b><small>{sources.length} total · {blocked} {tr(locale, "not crawlable", "不可抓取")}</small></Link>
      <Link className="admin-stat admin-stat-filter" aria-current={filter === "new" ? "true" : undefined} href={filterHref("new")} title={tr(locale, "Filter sources with new research in 24h", "筛选24小时内有新增研报的来源")}><span>{tr(locale, "New research · 24h", "24 小时新增研报")}</span><b>{articles24h}</b><small>{articles7d} / 7d</small></Link>
      <Link className="admin-stat admin-stat-filter" aria-current={filter === "unhealthy" ? "true" : undefined} href={filterHref("unhealthy")} title={tr(locale, "Filter unhealthy sources", "筛选异常来源")}><span>{tr(locale, "Unhealthy", "异常来源")}</span><b>{unhealthy}</b><small>{tr(locale, "failed, refused or circuit-open", "失败、被拒或熔断")}</small></Link>
      {/* A pipeline that succeeds while bringing nothing back reports as healthy
          everywhere else; this is the one place it shows. */}
      <Link className={`admin-stat admin-stat-filter${health.stalled.length ? " admin-stat-alarm" : ""}`} aria-current={filter === "recent" ? "true" : undefined} href={filterHref("recent")} title={tr(locale, "Filter sources that succeeded in 24h", "筛选24小时内成功入库的来源")}>
        <span>{tr(locale, "Newest research", "最近入库")}</span>
        <b>{health.articleAgeHours === null ? "—" : health.articleAgeHours < 1 ? tr(locale, "<1h", "1 小时内") : `${health.articleAgeHours.toFixed(0)}h`}</b>
        <small>{health.stalled.length ? health.stalled.join(" · ") : tr(locale, `${health.workingSources}/${health.crawlableSources} sources succeeded / 24h`, `24 小时内 ${health.workingSources}/${health.crawlableSources} 家来源成功`)}</small>
      </Link>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Source monitoring", "来源监控")}</span><span className="tag-row">{filter && <><span className="chip acc">{filterLabels[filter]}</span><Link className="minibtn" href={localePath(locale, "/admin/sources")}>{tr(locale, "Clear filter", "清除筛选")}</Link></>}<span className="chip gray">{visibleSources.length}/{sources.length}</span></span></div>
      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Institution", "机构")}</th>
          <th>{tr(locale, "Status", "状态")}</th>
          <th>{tr(locale, "Last success", "最近成功")}</th>
          <th>{tr(locale, "Policy", "合规策略")}</th>
          <th>{tr(locale, "Action", "操作")}</th>
        </tr></thead>
        <tbody>{visibleSources.map((source) => {
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
        })}{!visibleSources.length && <tr><td colSpan={5}>{tr(locale, "No sources match this filter.", "没有符合当前筛选条件的来源。")}</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}
