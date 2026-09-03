import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { queueContentRetry, queueSourceRetry, setSourceMonitoring } from "./actions";
import { pipelineHealth } from "@/../scripts/watchdog";

export const dynamic = "force-dynamic";

function json(value: string) {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function age(value: Date | null, locale: string) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - value.getTime()) / 60_000));
  if (minutes < 60) return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return locale === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return locale === "zh-CN" ? `${days} 天前` : `${days}d ago`;
}

const tone = (status: string | null) => status === "succeeded" || status === "reviewed" ? "bull" : status === "failed" || status === "needs_review" ? "bear" : status === "running" || status === "queued" ? "acc" : "gray";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getLocale();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [sources, jobs, articles24h, articles7d, analysisReview, translationReview, runningJobs, failedJobs, workers, staleJobs, health] = await Promise.all([
    prisma.institution.findMany({ orderBy: [{ monitoringEnabled: "desc" }, { priority: "asc" }, { name: "asc" }] }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.article.count({ where: { createdAt: { gte: since } } }),
    prisma.article.count({ where: { createdAt: { gte: week } } }),
    prisma.analysis.findMany({ where: { reviewStatus: "needs_review" }, orderBy: { createdAt: "desc" }, take: 10, include: { article: { include: { institution: true } } } }),
    prisma.articleTranslation.findMany({ where: { status: "needs_review" }, orderBy: { updatedAt: "desc" }, take: 10, include: { article: { include: { institution: true } } } }),
    prisma.jobRun.count({ where: { status: "running" } }),
    prisma.jobRun.count({ where: { status: "failed", startedAt: { gte: since } } }),
    prisma.workerHeartbeat.findMany({ orderBy: { name: "asc" } }),
    prisma.jobRun.count({ where: { status: "running", startedAt: { lt: new Date(Date.now() - 20 * 60_000) } } }),
    pipelineHealth(),
  ]);
  const enabled = sources.filter((source) => source.monitoringEnabled && ["allowed", "delayed"].includes(source.crawlPolicy)).length;
  const unhealthy = sources.filter((source) => ["failed", "refused", "paused"].includes(source.lastCrawlStatus ?? "") || (!source.monitoringEnabled && source.consecutiveFailures > 0)).length;
  const reviewCount = analysisReview.length + translationReview.length;

  return <main className="wrap admin-page">
    <header className="page-head admin-head">
      <div><div className="eyebrow">Operations Console</div><h1>{tr(locale, "Operations", "运营后台")}</h1><p className="sub">{tr(locale, "Source health, pipeline runs and editorial review in one place.", "统一查看来源健康度、流水线任务和内容审核。")}</p></div>
      <div className="tag-row"><span className="chip acc">{user.role}</span><Link className="minibtn" href="/admin/api-keys">{tr(locale, "API keys", "API 密钥")} →</Link><a className="minibtn" href="/api/health" target="_blank" rel="noreferrer">Health JSON ↗</a></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Operations summary", "运营概览")}>
      <div className="admin-stat"><span>{tr(locale, "Monitored sources", "监控来源")}</span><b>{enabled}</b><small>{sources.length} total</small></div>
      <div className="admin-stat"><span>{tr(locale, "New research · 24h", "24 小时新增研报")}</span><b>{articles24h}</b><small>{articles7d} / 7d</small></div>
      <div className="admin-stat"><span>{tr(locale, "Needs review", "待审核")}</span><b>{reviewCount}</b><small>{tr(locale, "analysis + translation", "分析与翻译")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Pipeline health", "流水线状态")}</span><b>{staleJobs ? "!" : runningJobs}</b><small>{failedJobs} failed / 24h · {staleJobs} stale · {unhealthy} sources</small></div>
      {/* A pipeline that succeeds while bringing nothing back reports as healthy
          everywhere else; this is the one place it shows. */}
      <div className={`admin-stat${health.stalled.length ? " admin-stat-alarm" : ""}`}>
        <span>{tr(locale, "Newest research", "最近入库")}</span>
        <b>{health.articleAgeHours === null ? "—" : health.articleAgeHours < 1 ? tr(locale, "<1h", "1 小时内") : `${health.articleAgeHours.toFixed(0)}h`}</b>
        <small>{health.stalled.length ? health.stalled.join(" · ") : tr(locale, `${health.workingSources}/${health.crawlableSources} sources succeeded / 24h`, `24 小时内 ${health.workingSources}/${health.crawlableSources} 家来源成功`)}</small>
      </div>
    </section>

    <div className="admin-columns">
      <section className="blk"><div className="section-t"><span>{tr(locale, "Source monitoring", "来源监控")}</span><span className="chip gray">{sources.length}</span></div>
        <div className="tbl-wrap"><table className="admin-table"><thead><tr><th>{tr(locale, "Institution", "机构")}</th><th>{tr(locale, "Status", "状态")}</th><th>{tr(locale, "Last success", "最近成功")}</th><th>{tr(locale, "Policy", "合规策略")}</th><th>{tr(locale, "Action", "操作")}</th></tr></thead><tbody>{sources.map((source) => {
          const compliant = ["allowed", "delayed"].includes(source.crawlPolicy);
          return <tr key={source.id}><td className="inst"><Link href={`/institution/${source.slug}`}>{source.name}</Link><small>{source.updateFreq ?? "—"}</small></td><td><span className={`chip ${tone(source.lastCrawlStatus)}`}>{source.monitoringEnabled ? source.lastCrawlStatus ?? "new" : source.consecutiveFailures > 0 ? "circuit_open" : "paused"}</span>{source.lastCrawlMessage && <small title={source.lastCrawlMessage}>{source.consecutiveFailures ? `${source.consecutiveFailures}× · ` : ""}{source.lastCrawlMessage}</small>}</td><td className="mono-cell">{age(source.lastSuccessAt, locale)}</td><td><span className={`chip ${compliant ? "gray" : "bear"}`}>{source.crawlPolicy}</span></td><td><div className="admin-actions">{user.role === "admin" && compliant && <><form action={setSourceMonitoring}><input type="hidden" name="id" value={source.id}/><input type="hidden" name="enabled" value={source.monitoringEnabled ? "false" : "true"}/><button className="minibtn" type="submit">{source.monitoringEnabled ? tr(locale, "Pause", "暂停") : tr(locale, "Resume", "恢复")}</button></form>{["failed", "paused"].includes(source.lastCrawlStatus ?? "") && <form action={queueSourceRetry}><input type="hidden" name="id" value={source.id}/><button className="minibtn p" type="submit">{tr(locale, "Next run", "加入下一轮")}</button></form>}</>}</div></td></tr>;
        })}</tbody></table></div>
      </section>

      <aside><section className="blk"><div className="section-t">{tr(locale, "Workers", "调度器心跳")}</div><div className="admin-workers">{["research", "macro"].map((name) => { const worker = workers.find((item) => item.name === name); const healthy = worker?.status === "running" && Date.now() - worker.lastSeenAt.getTime() < 120_000; return <div key={name}><b>{name}</b><span className={`chip ${healthy ? "bull" : "bear"}`}>{healthy ? "ok" : "stale"}</span><small>{age(worker?.lastSeenAt ?? null, locale)}</small></div>; })}</div></section>
        <section className="blk"><div className="section-t">{tr(locale, "Needs review", "待审核")}</div><div className="admin-review-list">{reviewCount ? <>{[
          ...analysisReview.map((item) => ({ key: `a-${item.id}`, article: item.article, kind: "analysis" as const })),
          ...translationReview.map((item) => ({ key: `t-${item.id}`, article: item.article, kind: "translation" as const })),
        ].map((item) => <div className="admin-review-row" key={item.key}>
          <Link href={`/research/${item.article.id}`}><span><b>{item.article.title}</b><small>{item.article.institution.name} · {item.kind}</small></span><span className="chip bear">needs_review</span></Link>
          {/* The rerun lives here rather than only on the report: this list is where an
              operator decides, and a decision that costs a page visit is not taken. */}
          {user.role === "admin" && <form action={queueContentRetry}>
            <input type="hidden" name="articleId" value={item.article.id} />
            <input type="hidden" name="kind" value={item.kind} />
            <button className="minibtn" type="submit">{tr(locale, "Re-run", "重跑")}</button>
          </form>}
        </div>)}</> : <div className="empty-state">{tr(locale, "Nothing is waiting for review.", "当前没有待审核内容。")}</div>}</div></section>
        <section className="blk"><div className="section-t">{tr(locale, "Recent jobs", "最近任务")}</div><div className="admin-jobs">{jobs.map((job) => { const metrics = json(job.metrics); return <div className="admin-job" key={job.id}><div><b>{job.name}</b><small>{age(job.startedAt, locale)} · attempt {job.attempt}</small></div><div className="admin-job-state"><span className={`chip ${tone(job.status)}`}>{job.status}</span>{Object.keys(metrics).length > 0 && <span className="mono admin-metric">{Object.entries(metrics).slice(0, 2).map(([key, value]) => `${key}:${String(value)}`).join(" · ")}</span>}</div>{job.error && <details><summary>{tr(locale, "Error", "错误")}</summary><p>{job.error}</p></details>}</div>; })}</div></section></aside>
    </div>
  </main>;
}
