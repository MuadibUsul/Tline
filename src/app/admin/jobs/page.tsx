import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { age, json, tone } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jobs" };

/** A heartbeat older than this means the scheduler process is gone, not merely idle. */
const HEARTBEAT_STALE_MS = 120_000;
/** A run still marked "running" after this long ended without saying so. */
const STALE_RUN_MS = 20 * 60_000;

export default async function JobsPage(props: { searchParams: Promise<{ name?: string; status?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getLocale();
  const { name, status } = await props.searchParams;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const where = {
    ...(name ? { name } : {}),
    ...(status === "failed" || status === "running" || status === "succeeded" ? { status } : {}),
  };

  const [jobs, workers, names, runningJobs, failedJobs, staleJobs, succeeded24h] = await Promise.all([
    prisma.jobRun.findMany({ where, orderBy: { startedAt: "desc" }, take: 80 }),
    prisma.workerHeartbeat.findMany({ orderBy: { name: "asc" } }),
    prisma.jobRun.findMany({ distinct: ["name"], select: { name: true }, orderBy: { name: "asc" } }),
    prisma.jobRun.count({ where: { status: "running" } }),
    prisma.jobRun.count({ where: { status: "failed", startedAt: { gte: since } } }),
    prisma.jobRun.count({ where: { status: "running", startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } } }),
    prisma.jobRun.count({ where: { status: "succeeded", startedAt: { gte: since } } }),
  ]);

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Jobs & workers", "任务与调度")}</h1>
        <p className="sub">{tr(locale, "Every tracked run, newest first, and whether the schedulers behind them are still alive.", "全部受跟踪的任务运行记录（按时间倒序），以及背后的调度进程是否仍在心跳。")}</p>
      </div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Job summary", "任务概览")}>
      <div className="admin-stat"><span>{tr(locale, "Running", "运行中")}</span><b>{runningJobs}</b><small>{staleJobs} {tr(locale, "stale", "疑似卡死")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Succeeded · 24h", "24 小时成功")}</span><b>{succeeded24h}</b><small>&nbsp;</small></div>
      <div className={`admin-stat${failedJobs ? " admin-stat-alarm" : ""}`}><span>{tr(locale, "Failed · 24h", "24 小时失败")}</span><b>{failedJobs}</b><small>&nbsp;</small></div>
      <div className="admin-stat"><span>{tr(locale, "Workers", "调度进程")}</span><b>{workers.filter((worker) => worker.status === "running" && Date.now() - worker.lastSeenAt.getTime() < HEARTBEAT_STALE_MS).length}/{workers.length || 2}</b><small>{tr(locale, "heartbeat within 2 min", "2 分钟内有心跳")}</small></div>
    </section>

    <div className="admin-columns">
      <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "Recent runs", "最近运行")}</span>
          <span className="chip gray">{jobs.length}</span>
        </div>
        {/* Plain links rather than a form: the filter belongs in the address, so an
            operator can bookmark "show me the failures" and share it. */}
        <div className="admin-filter-row">
          <a className={`minibtn${!status && !name ? " p" : ""}`} href="?">{tr(locale, "All", "全部")}</a>
          <a className={`minibtn${status === "failed" ? " p" : ""}`} href="?status=failed">{tr(locale, "Failed", "失败")}</a>
          <a className={`minibtn${status === "running" ? " p" : ""}`} href="?status=running">{tr(locale, "Running", "运行中")}</a>
          {names.map((row) => <a key={row.name} className={`minibtn${name === row.name ? " p" : ""}`} href={`?name=${encodeURIComponent(row.name)}`}>{row.name}</a>)}
        </div>
        <div className="admin-jobs">
          {jobs.length === 0 && <div className="empty-state">{tr(locale, "No runs match this filter.", "没有符合筛选条件的运行记录。")}</div>}
          {jobs.map((job) => {
            const metrics = json(job.metrics);
            const stale = job.status === "running" && Date.now() - job.startedAt.getTime() > STALE_RUN_MS;
            return <div className="admin-job" key={job.id}>
              <div><b>{job.name}</b><small>{age(job.startedAt, locale)} · attempt {job.attempt}{job.finishedAt ? ` · ${Math.max(0, Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000))}s` : ""}</small></div>
              <div className="admin-job-state">
                <span className={`chip ${stale ? "bear" : tone(job.status)}`}>{stale ? "stale" : job.status}</span>
                {Object.keys(metrics).length > 0 && <span className="mono admin-metric">{Object.entries(metrics).slice(0, 3).map(([key, value]) => `${key}:${String(value)}`).join(" · ")}</span>}
              </div>
              {job.error && <details><summary>{tr(locale, "Error", "错误")}</summary><p>{job.error}</p></details>}
            </div>;
          })}
        </div>
      </section>

      <aside>
        <section className="blk">
          <div className="section-t">{tr(locale, "Workers", "调度器心跳")}</div>
          <div className="admin-workers">{["research", "macro"].map((workerName) => {
            const worker = workers.find((item) => item.name === workerName);
            const healthy = worker?.status === "running" && Date.now() - worker.lastSeenAt.getTime() < HEARTBEAT_STALE_MS;
            return <div key={workerName}><b>{workerName}</b><span className={`chip ${healthy ? "bull" : "bear"}`}>{healthy ? "ok" : "stale"}</span><small>{age(worker?.lastSeenAt ?? null, locale)}</small></div>;
          })}</div>
        </section>
      </aside>
    </div>
  </>;
}
