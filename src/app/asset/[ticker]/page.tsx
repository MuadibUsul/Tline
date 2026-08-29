import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetView, getAssetTimeline } from "@/lib/queries";
import { FeedCard, DirChip, Delta, relTime } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";
import { assetName, domainTerm, formatDate, getLocale, institutionName, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: { ticker: string } }) {
  const locale = getLocale();
  const data = await getAssetView(params.ticker);
  if (!data) notFound();
  const { asset, consensus, d1, d7, d30, dist, articles } = data;
  const timeline = (await getAssetTimeline(asset.id)).filter((t) => t.hasTargetMove || t.hasDirFlip);
  const toneColor = consensus?.tone === "bull" ? "var(--bull)" : consensus?.tone === "bear" ? "var(--bear)" : "var(--neu)";

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{consensus?.isFallback ? tr(locale, `Institutional Consensus · latest available 24h · as of ${formatDate(consensus.windowEnd, locale)}`, `机构共识 · 最近可用24小时 · 截至 ${formatDate(consensus.windowEnd, locale)}`) : tr(locale, "Institutional Consensus · last 24h", "机构共识 · 最近24小时")} · {domainTerm(asset.assetClass, locale)}</div>
        <h1>{assetName(asset.name, locale, asset.ticker)}</h1>
        {consensus ? <>
          <div className="big-score">
            <span className="num" style={{ color: toneColor }}>{consensus.score}</span>
            <span className="mono" style={{ color: "var(--muted)" }}>/ 100</span>
            <span className={`chip ${consensus.tone}`}>{consensus.tone === "bull" ? tr(locale, consensus.label, "看多") : consensus.tone === "bear" ? tr(locale, consensus.label, "看空") : tr(locale, consensus.label, "中性")}</span>
          </div>
          <div className="deltas">
            <span>1D <Delta v={d1} /></span>
            <span>7D <Delta v={d7} /></span>
            <span>30D <Delta v={d30} /></span>
            <span style={{ color: "var(--faint)" }}>{tr(locale, `${consensus.institutionCount} institutions`, `${consensus.institutionCount} 家机构`)} · {consensus.bullishCount}↑ {consensus.neutralCount}→ {consensus.bearishCount}↓</span>
          </div>
        </> : <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "No institutional view has been recorded for this asset yet.", "该资产尚未收录任何机构观点。")}</p>}
        <form action={addWatch} style={{ alignSelf: "flex-start" }}>
          <input type="hidden" name="kind" value="asset" />
          <input type="hidden" name="refId" value={asset.ticker} />
          <input type="hidden" name="back" value={`/asset/${asset.ticker}`} />
          <button type="submit" className="minibtn">＋ {tr(locale, "Watch", "关注")}</button>
        </form>
      </div>

      {consensus && <section className="blk">
        <div className="section-t">{consensus.isFallback ? tr(locale, "Institutional Views · latest available 24h", "机构观点 · 最近可用24小时") : tr(locale, "Institutional Views · last 24h", "机构观点 · 最近24小时")}</div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Institution", "机构")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Target", "目标价")}</th><th>{tr(locale, "Previous", "此前")}</th><th>{tr(locale, "Updated", "更新于")}</th></tr></thead>
            <tbody>
              {consensus.contributors.map((c, i) => (
                <tr key={i}>
                  <td className="inst"><Link href={`/institution/${c.slug}`}>{institutionName(c.institutionName, locale)}</Link></td>
                  <td><DirChip direction={c.direction} locale={locale} showLabel={false} /></td>
                  <td className="mono-cell">{c.target ? `$${c.target.toLocaleString()}` : "—"}</td>
                  <td className="mono-cell" style={{ color: "var(--faint)" }}>{c.previousTarget ? `$${c.previousTarget.toLocaleString()}` : "—"}</td>
                  <td className="mono-cell">{relTime(c.publishedAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      {timeline.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Recent View Changes", "近期观点变化")}</div>
          <div className="changes">
            {timeline.map((t) => (
              <div key={t.slug} className="chg">
                <Link href={`/institution/${t.slug}`} className="chg-inst">{institutionName(t.institution, locale)}</Link>
                <div className="chg-body">
                  {t.hasTargetMove && (
                    <div className="chain">
                      {t.targetChain.map((v, i) => (
                        <span key={i} className="chain-node">
                          <span className={`tgt ${i === t.targetChain.length - 1 ? "cur" : ""}`}>${v.toLocaleString()}</span>
                          {i < t.targetChain.length - 1 && <span className="arw">→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.hasDirFlip && (
                    <div className="chain">
                      {t.dirChain.map((d, i) => (
                        <span key={i} className="chain-node">
                          <span className={`chip ${d.tone}`}>{d.tone === "bull" ? tr(locale, d.label, "看多") : d.tone === "bear" ? tr(locale, d.label, "看空") : tr(locale, d.label, "中性")}</span>
                          {i < t.dirChain.length - 1 && <span className="arw">→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{relTime(t.lastChange, locale)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {dist && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Target Distribution", "目标价分布")}</div>
          <div className="dist">
            <div className="stat"><span>{tr(locale, "Lowest", "最低")}</span><b>${dist.low.toLocaleString()}</b></div>
            <div className="stat"><span>{tr(locale, "Median", "中位数")}</span><b>${dist.median.toLocaleString()}</b></div>
            <div className="stat"><span>{tr(locale, "Average", "平均")}</span><b>${dist.avg.toLocaleString()}</b></div>
            <div className="stat"><span>{tr(locale, "Highest", "最高")}</span><b className="up">${dist.high.toLocaleString()}</b></div>
          </div>
        </section>
      )}

      <section style={{ paddingTop: 26 }}>
        <div className="section-t">{tr(locale, "Related Research", "相关研报")}</div>
        <div className="feed">
          {articles.map((a) => <FeedCard key={a.id} a={a} locale={locale} />)}
        </div>
      </section>
    </main>
  );
}
