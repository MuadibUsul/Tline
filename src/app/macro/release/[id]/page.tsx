import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getLocale, tr, type Locale } from "@/lib/i18n";
import { actualText, consensusText, macroDateTime, macroNumber, unitLabel } from "@/lib/macro/presentation";
import { getReleaseConsensus } from "@/lib/macro/releaseConsensus";
import type { ForecastConsensus } from "@/lib/macro/forecasts";
import type { ParsedPolicyDocument } from "@/lib/macro/policy/types";

export const dynamic = "force-dynamic";
const parsed = (value: string | null) => { try { return value ? JSON.parse(value) as ParsedPolicyDocument : null; } catch { return null; } };

// Trim a numeric forecast for display: keep meaningful decimals, drop trailing zeros.
const num = (value: number) => (Math.round(value * 1000) / 1000).toString();

/** Horizontal distribution of the mined bank forecasts, with median and (once out) the actual. */
function ConsensusDistribution({ consensus, actual, locale }: { consensus: ForecastConsensus; actual: number | null; locale: Locale }) {
  const points = consensus.contributors.map((c) => c.value);
  const lo = Math.min(consensus.min ?? points[0], actual ?? consensus.min ?? points[0]);
  const hi = Math.max(consensus.max ?? points[0], actual ?? consensus.max ?? points[0]);
  const span = hi - lo;
  // 4%..96% keeps edge markers on-track; a zero-spread set (single forecast) sits centred.
  const pos = (value: number) => (span === 0 ? 50 : 4 + ((value - lo) / span) * 92);
  return (
    <div style={{ margin: "18px 0 6px" }}>
      <div style={{ position: "relative", height: 46, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "var(--border-strong)" }} />
        {consensus.contributors.map((c, index) => (
          <div key={index} title={`${c.institution}: ${num(c.value)}`} style={{ position: "absolute", left: `${pos(c.value)}%`, top: "50%", width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: "50%", background: "var(--accent)", opacity: 0.55, border: "1px solid var(--accent-ink)" }} />
        ))}
        {consensus.median !== null && (
          <div style={{ position: "absolute", left: `${pos(consensus.median)}%`, top: 6, bottom: 6, width: 2, marginLeft: -1, background: "var(--ink)" }} title={`${tr(locale, "Consensus (median)", "共识（中位数）")}: ${num(consensus.median)}`} />
        )}
        {actual !== null && (
          <div style={{ position: "absolute", left: `${pos(actual)}%`, top: 4, bottom: 4, width: 2.5, marginLeft: -1.25, background: "var(--bull)" }} title={`${tr(locale, "Actual", "实际值")}: ${num(actual)}`} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)" }}>
        <span>{num(lo)}</span>
        <span style={{ display: "inline-flex", gap: 14 }}>
          <span style={{ color: "var(--ink)" }}>▏{tr(locale, "median", "中位")}</span>
          {actual !== null && <span style={{ color: "var(--bull)" }}>▏{tr(locale, "actual", "实际")}</span>}
          <span style={{ color: "var(--accent-ink)" }}>● {tr(locale, "bank forecast", "投行预期")}</span>
        </span>
        <span>{num(hi)}</span>
      </div>
    </div>
  );
}

export default async function MacroReleasePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const release = await prisma.macroRelease.findUnique({ where: { id: params.id }, include: { values: { include: { indicator: true } }, policyDocuments: { orderBy: { publishedAt: "desc" } } } });
  if (!release) notFound();
  const policy = release.policyDocuments.map((document) => ({ document, value: parsed(document.parsedJson) }));

  // P2: our own institutional consensus, mined from bank research, plus the AI read-out.
  const consensus = await getReleaseConsensus(release);
  const primary = release.values[0];
  const released = release.status === "RELEASED";
  const actual = primary?.actualInitial != null ? Number(primary.actualInitial.toString()) : null;
  const unit = primary?.indicator?.unit ? unitLabel(primary.indicator.unit, locale) : consensus?.unit ?? "";
  const surprise = released && actual !== null && consensus?.median != null ? actual - consensus.median : null;
  const surpriseTone = surprise === null ? "gray" : surprise > 0 ? "bull" : surprise < 0 ? "bear" : "neu";
  const surpriseLabel = surprise === null ? "" : surprise > 0 ? tr(locale, "above consensus", "高于共识") : surprise < 0 ? tr(locale, "below consensus", "低于共识") : tr(locale, "in line", "符合共识");
  const analysis = locale === "zh-CN" ? release.analysisZh ?? release.analysisEn : release.analysisEn;

  return <main className="wrap"><div className="page-head"><div className="eyebrow">{release.countryCode} · {release.agency} · {release.status}</div><h1>{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}</h1><div className="deltas"><span>{tr(locale, "Scheduled", "计划")}: {macroDateTime(release.scheduledAt, locale, release.sourceTimezone)}</span><span>{tr(locale, "Released", "发布")}: {release.releasedAt ? macroDateTime(release.releasedAt, locale, release.sourceTimezone) : tr(locale, "Not released", "尚未发布")}</span></div><div className="tag-row"><Link className="minibtn" href="/macro/calendar">← {tr(locale, "Calendar", "日历")}</Link>{release.sourceUrl && <a className="minibtn p" href={release.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Official source ↗", "官方来源 ↗")}</a>}</div></div>

    <section className="blk"><div className="section-t">{tr(locale, "Release values", "发布值")}</div><div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Indicator", "指标")}</th><th>{tr(locale, "Period", "数据期")}</th><th>{tr(locale, "Previous", "前值")}</th><th>{tr(locale, "Revised previous", "修订前值")}</th><th>{tr(locale, "Consensus", "共识")}</th><th>{tr(locale, "Actual initial", "实际初值")}</th></tr></thead><tbody>{release.values.map((value) => <tr key={value.id}><td className="inst"><Link href={`/macro/indicator/${value.indicator.canonicalKey}`}>{locale === "zh-CN" ? value.indicator.nameZh ?? value.indicator.nameEn : value.indicator.nameEn}</Link></td><td className="mono-cell">{value.observationPeriod.toISOString().slice(0, 10)}</td><td className="mono-cell">{macroNumber(value.previousAtRelease, locale)}</td><td className="mono-cell">{macroNumber(value.revisedPreviousAtRelease, locale)}</td><td className="mono-cell">{consensusText(value.consensusAtRelease, locale)}</td><td className="mono-cell">{actualText(value.actualInitial, released, locale)}</td></tr>)}</tbody></table></div></section>

    <section className="blk"><div className="section-t">{tr(locale, "Institutional consensus (mined from bank research)", "机构预期共识（自投行研报清洗）")}</div>
      {consensus ? <>
        <div className="dist" style={{ marginTop: 14 }}>
          <div className="stat"><span>{tr(locale, "Consensus (median)", "共识（中位数）")}</span><b>{consensus.median !== null ? num(consensus.median) : "N/A"}{unit ? ` ${unit}` : ""}</b></div>
          <div className="stat"><span>{tr(locale, "Mean", "均值")}</span><b>{consensus.mean !== null ? num(consensus.mean) : "N/A"}</b></div>
          <div className="stat"><span>{tr(locale, "Range", "区间")}</span><b>{consensus.min !== null ? num(consensus.min) : "N/A"}–{consensus.max !== null ? num(consensus.max) : "N/A"}</b></div>
          <div className="stat"><span>{tr(locale, "Contributing banks", "参与投行")}</span><b>{consensus.count}</b></div>
          {released && actual !== null && <div className="stat"><span>{tr(locale, "Actual vs consensus", "实际 vs 共识")}</span><b><span className={`chip ${surpriseTone}`}>{surprise! > 0 ? "+" : ""}{surprise !== null ? num(surprise) : ""} · {surpriseLabel}</span></b></div>}
        </div>
        <ConsensusDistribution consensus={consensus} actual={actual} locale={locale} />
        <details style={{ marginTop: 10 }}><summary>{tr(locale, `Bank forecasts (${consensus.count})`, `投行预期（${consensus.count}）`)}</summary><div className="tbl-wrap" style={{ marginTop: 8 }}><table><thead><tr><th>{tr(locale, "Institution", "机构")}</th><th>{tr(locale, "Forecast", "预期值")}</th></tr></thead><tbody>{consensus.contributors.map((c, index) => <tr key={index}><td className="inst">{c.institution}</td><td className="mono-cell">{num(c.value)}{unit ? ` ${unit}` : ""}</td></tr>)}</tbody></table></div></details>
      </> : <p style={{ color: "var(--muted)", marginTop: 12 }}>{tr(locale, "No bank forecasts have been mined for this release yet. Forecasts are extracted automatically from institutional research as it is ingested.", "尚未从研报中清洗出该项发布的投行预期。系统会在研报入库时自动提取预期值。")}</p>}
    </section>

    {analysis && <section className="blk"><div className="section-t">{tr(locale, "AI read-out", "AI 解读")}</div><div className="ai-analysis-label">{tr(locale, "AI-generated · actual vs consensus and previous · not investment advice", "AI 生成 · 实际值对比共识与前值 · 非投资建议")}{release.analysisAt ? ` · ${macroDateTime(release.analysisAt, locale, release.sourceTimezone)}` : ""}</div>{analysis.split(/\n{2,}/).filter(Boolean).map((para, index) => <p key={index} style={{ marginTop: 10, lineHeight: 1.7 }}>{para}</p>)}</section>}

    {policy.length > 0 && <section className="blk"><div className="section-t">{tr(locale, "Policy documents", "政策文件")}</div><div className="feed">{policy.map(({ document, value }) => <article className="card" key={document.id}><div className="tag-row"><span className="chip acc">{document.docType}</span><span className="chip gray">{document.provider ?? "deterministic"} · {document.reviewStatus}</span></div>{value && <><div className="dist" style={{ marginTop: 14 }}><div className="stat"><span>{tr(locale, "Decision", "决策")}</span><b>{value.decision}</b></div><div className="stat"><span>{tr(locale, "Target range", "目标区间")}</span><b>{value.targetRateLower ?? "N/A"}–{value.targetRateUpper ?? "N/A"}</b></div><div className="stat"><span>{tr(locale, "Change", "变动")}</span><b>{value.changeBps ?? "N/A"} bps</b></div><div className="stat"><span>{tr(locale, "Stance", "立场")}</span><b>{value.stance}</b></div></div>{[value.inflationAssessment, value.growthAssessment, value.laborAssessment, value.forwardGuidance, value.balanceSheetAction].filter(Boolean).map((text, index) => <p key={index}>{text}</p>)}<details><summary>{tr(locale, "Source quotes", "原文引句")}</summary>{value.sourceQuotes.map((item, index) => <blockquote key={index}>{item.field}: “{item.quote}”</blockquote>)}</details></>}<a href={document.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn" style={{ display: "inline-block", marginTop: 12 }}>{tr(locale, "Official document ↗", "官方文件 ↗")}</a></article>)}</div></section>}
  </main>;
}
