import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { age, when } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "数据闭环" };

export default async function DataOperationsPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.sources")) notFound();
  const staleBefore = new Date(Date.now() - 2 * 86400_000);
  const [instruments, mappings, observations, stale, policies, expectations, frozen, forecastGroups, usage, sync] = await Promise.all([
    prisma.marketInstrument.count({ where: { enabled: true } }),
    prisma.marketInstrumentSource.findMany({ include: { instrument: { select: { symbol: true, quoteCurrency: true, assetId: true, isProxy: true } } }, orderBy: [{ enabled: "desc" }, { provider: "asc" }] }),
    prisma.marketObservation.count({ where: { status: "PUBLISHED" } }),
    prisma.marketObservation.count({ where: { status: "PUBLISHED", observedAt: { lt: staleBefore } } }),
    prisma.dataLicensePolicy.findMany({ orderBy: [{ status: "asc" }, { provider: "asc" }] }),
    prisma.macroExpectation.count(),
    prisma.macroReleaseValue.count({ where: { OR: [{ consensusExpectationId: { not: null } }, { modelExpectationId: { not: null } }] } }),
    prisma.forecast.groupBy({ by: ["status", "settlementReason"], _count: { _all: true }, orderBy: { _count: { status: "desc" } }, take: 12 }),
    prisma.providerUsage.findMany({ orderBy: { updatedAt: "desc" }, take: 12 }),
    prisma.macroSyncState.findMany({ where: { provider: { in: ["twelvedata", "release-watcher", "release-analysis"] } }, orderBy: { updatedAt: "desc" }, take: 12 }),
  ]);
  const mappingIssues = mappings.filter((row) => !row.instrument.assetId || row.quoteCurrency !== row.instrument.quoteCurrency);
  const pendingPolicies = policies.filter((row) => row.status !== "CONFIRMED");

  return <>
    <header className="page-head admin-head"><div><span className="eyebrow">数据运维</span><h1>行情与宏观预期</h1><p className="sub">在一个页面检查授权、额度、标的映射、预期快照与预测结算；这里只展示状态，不会从网页触发上游采集。</p></div></header>
    <section className="admin-stats">
      <div className={`admin-stat${mappingIssues.length ? " admin-stat-alarm" : ""}`}><span>有效标的</span><b>{instruments}</b><small>{mappings.length} 个供应商映射 · {mappingIssues.length} 个问题</small></div>
      <div className={`admin-stat${stale ? " admin-stat-alarm" : ""}`}><span>已发布行情观测</span><b>{observations}</b><small>{stale} 条超过两天（仍需结合休市判断）</small></div>
      <div className={`admin-stat${pendingPolicies.length ? " admin-stat-alarm" : ""}`}><span>用途授权</span><b>{policies.length - pendingPolicies.length}/{policies.length}</b><small>{pendingPolicies.length} 项待确认或受限</small></div>
      <div className="admin-stat"><span>宏观预期快照</span><b>{frozen}</b><small>{expectations} 个只追加版本</small></div>
    </section>

    <div className="admin-columns">
      <section className="blk"><div className="section-t"><span>授权依据</span><span className="chip gray">默认拒绝</span></div><div className="tbl-wrap"><table className="admin-table"><thead><tr><th>数据集</th><th>状态</th><th>允许用途</th><th>确认</th></tr></thead><tbody>{policies.map((row) => <tr key={row.id}><td className="inst">{row.datasetKey}<small>{row.provider}</small></td><td><span className={`chip ${row.status === "CONFIRMED" ? "bull" : "bear"}`}>{row.status === "CONFIRMED" ? "已确认" : row.status}</span></td><td className="mono-cell">{row.allowedUses}</td><td>{row.confirmedBy ?? "—"}<small>{when(row.confirmedAt, "zh-CN")}</small></td></tr>)}{!policies.length && <tr><td colSpan={4}>尚无授权记录；所有数字用途保持关闭。</td></tr>}</tbody></table></div></section>

      <section className="blk"><div className="section-t"><span>额度使用</span><span className="chip gray">请求前预留</span></div><div className="admin-jobs">{usage.map((row) => <div className="admin-job" key={row.id}><div><b>{row.provider} · {row.window}</b><small>{row.periodKey}</small></div><div className="admin-job-state"><span className="mono admin-metric">{row.usedUnits} credits</span></div></div>)}{!usage.length && <p className="admin-hint">尚无持久化额度记录。</p>}</div></section>
    </div>

    <section className="blk"><div className="section-t"><span>标的映射</span><span className="chip gray">币种与场所必须精确匹配</span></div><div className="tbl-wrap"><table className="admin-table"><thead><tr><th>内部标的</th><th>供应商代码</th><th>场所</th><th>报价币种</th><th>状态</th></tr></thead><tbody>{mappings.map((row) => { const issue = !row.instrument.assetId || row.quoteCurrency !== row.instrument.quoteCurrency; return <tr key={row.id}><td className="inst">{row.instrument.symbol}<small>{row.instrument.isProxy ? "代理资产" : "直接标的"}</small></td><td>{row.provider} · {row.externalSymbol}</td><td>{row.venue ?? "—"}</td><td>{row.quoteCurrency}</td><td><span className={`chip ${issue ? "bear" : row.enabled ? "bull" : "gray"}`}>{issue ? "待修复" : row.enabled ? "启用" : "停用"}</span></td></tr>; })}{!mappings.length && <tr><td colSpan={5}>尚无供应商映射。</td></tr>}</tbody></table></div></section>

    <div className="admin-columns">
      <section className="blk"><div className="section-t"><span>预测结算</span><span className="chip gray">按原因汇总</span></div><div className="admin-jobs">{forecastGroups.map((row, index) => <div className="admin-job" key={`${row.status}-${row.settlementReason}-${index}`}><div><b>{row.status === "settled" ? "已结算" : row.status === "excluded" ? "已排除" : "待结算"}</b><small>{row.settlementReason ?? "无附加原因"}</small></div><div className="admin-job-state"><b>{row._count._all}</b></div></div>)}</div></section>
      <section className="blk"><div className="section-t"><span>最近同步状态</span><span className="chip gray">行情 / 发布 / 解读</span></div><div className="admin-jobs">{sync.map((row) => <div className="admin-job" key={row.id}><div><b>{row.provider}</b><small>{row.scopeKey} · {age(row.lastAttemptAt, "zh-CN")}</small></div><div className="admin-job-state"><span className={`chip ${row.lastStatus === "released" || row.lastStatus === "succeeded" ? "bull" : row.lastError ? "bear" : "gray"}`}>{row.lastStatus}</span>{row.lastError && <span className="mono admin-metric" title={row.lastError}>{row.lastError.slice(0, 60)}</span>}</div></div>)}</div></section>
    </div>
  </>;
}
