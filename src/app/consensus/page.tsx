import Link from "next/link";
import { computeConsensus } from "@/lib/consensus";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

export default async function ConsensusPage() {
  const locale = getLocale();
  const assets = await prisma.asset.findMany({ orderBy: { assetClass: "asc" } });
  const rows = [] as { ticker: string; name: string; cls: string; score: number; tone: string; label: string; n: number }[];
  for (const a of assets) {
    const c = await computeConsensus(a.id);
    if (!c) continue;
    rows.push({ ticker: a.ticker, name: a.name, cls: a.assetClass, score: c.score, tone: c.tone, label: c.label, n: c.institutionCount });
  }
  rows.sort((x, y) => y.score - x.score);

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">{tr(locale, "Institutional Consensus Engine", "机构共识引擎")}</div><h1>{tr(locale, "Consensus", "共识")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Authority-weighted, time-decayed direction across all covered assets (0–100).", "基于机构权威度加权并按时间衰减，计算所有覆盖资产的方向评分（0–100）。")}</p></div>
      <section style={{ paddingTop: 22 }}>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Class", "类别")}</th><th>{tr(locale, "Consensus", "共识")}</th><th>{tr(locale, "Signal", "信号")}</th><th>{tr(locale, "Institutions", "机构数")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker}>
                  <td className="inst"><Link href={`/consensus/${r.ticker}`}>{r.name}</Link></td>
                  <td className="mono-cell" style={{ color: "var(--muted)" }}>{r.cls}</td>
                  <td className="mono-cell" style={{ fontWeight: 700, color: TONE[r.tone] }}>{r.score}</td>
                  <td><span className={`chip ${r.tone}`}>{r.tone === "bull" ? tr(locale, r.label, "看多") : r.tone === "bear" ? tr(locale, r.label, "看空") : tr(locale, r.label, "中性")}</span></td>
                  <td className="mono-cell">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
