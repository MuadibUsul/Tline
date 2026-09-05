import type { Metadata } from "next";
import { canonical, datasetJsonLd, JsonLd, ogImage, webPageJsonLd } from "@/lib/seo";
import Link from "next/link";
import { computeConsensusMany } from "@/lib/consensus";
import { prisma } from "@/lib/db";
import { assetName, domainTerm, formatDate, getLocale, tr, localePath } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = tr(locale, "Institutional Consensus by Asset", "按资产汇总的机构共识"); const description = tr(locale, "Authority-weighted, time-aware consensus scores derived from source-linked institutional research.", "从带来源的机构研报生成、按权威度加权并包含时间上下文的共识评分。");
  return { ...canonical("/consensus", locale), title, description, openGraph: { images: [{ url: ogImage("Consensus", "Institutional Consensus by Asset", "Authority-weighted, time-aware market signals"), width: 1200, height: 630 }] } };
}
const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

export default async function ConsensusPage() {
  const locale = await getLocale();
  const assets = await prisma.asset.findMany({ orderBy: { assetClass: "asc" } });
  // Score every asset in two batched queries instead of one-to-three per asset.
  const consensus = await computeConsensusMany(assets.map((a) => a.id));
  const rows = assets.flatMap((a) => {
    const c = consensus.get(a.id);
    return c
      ? [{ ticker: a.ticker, name: a.name, cls: a.assetClass, score: c.score, tone: c.tone, label: c.label, n: c.institutionCount, isFallback: c.isFallback, windowEnd: c.windowEnd }]
      : [];
  });
  rows.sort((x, y) => y.score - x.score);

  return (
    <main className="wrap">
      <JsonLd data={webPageJsonLd(locale, "/consensus", tr(locale, "Institutional Consensus", "机构共识"), tr(locale, "Comparable consensus signals aggregated from public institutional research.", "从公开机构研报汇总的可比较共识信号。"))} />
      <JsonLd data={datasetJsonLd(locale, "/consensus", tr(locale, "Tlines Institutional Consensus Dataset", "Tlines 机构共识数据集"), tr(locale, "Asset-level consensus scores with institution count and time context.", "包含机构数量与时间上下文的资产级共识评分。"))} />
      <div className="page-head"><div className="eyebrow">{tr(locale, "Institutional Consensus Engine", "机构共识引擎")}</div><h1>{tr(locale, "Consensus", "共识")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Authority-weighted direction from the rolling last 24 hours; assets without current research use their latest available 24-hour window (0–100).", "按机构权威度计算滚动最近24小时的方向评分；没有新研报的资产沿用其最近可用24小时窗口（0–100）。")}</p></div>
      <section style={{ paddingTop: 22 }}>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Class", "类别")}</th><th>{tr(locale, "Consensus", "共识")}</th><th>{tr(locale, "Signal", "信号")}</th><th>{tr(locale, "Institutions", "机构数")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker}>
                  <td className="inst"><Link href={localePath(locale, `/consensus/${r.ticker}`)}>{assetName(r.name, locale, r.ticker)}</Link></td>
                  <td className="mono-cell" style={{ color: "var(--muted)" }}>{domainTerm(r.cls, locale)}</td>
                  <td className="mono-cell" style={{ fontWeight: 700, color: TONE[r.tone] }}>{r.score}</td>
                  <td><span className={`chip ${r.tone}`}>{r.tone === "bull" ? tr(locale, r.label, "看多") : r.tone === "bear" ? tr(locale, r.label, "看空") : tr(locale, r.label, "中性")}</span></td>
                  <td className="mono-cell">{r.n}{r.isFallback && <small style={{ display: "block", color: "var(--faint)" }}>{tr(locale, "as of", "截至")} {formatDate(r.windowEnd, locale)}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
