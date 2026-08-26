import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetView, getAssetTimeline } from "@/lib/queries";
import { FeedCard, DirChip, Delta, relTime } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: { ticker: string } }) {
  const data = await getAssetView(params.ticker);
  if (!data || !data.consensus) notFound();
  const { asset, consensus, d1, d7, d30, dist, articles } = data;
  const timeline = (await getAssetTimeline(asset.id)).filter((t) => t.hasTargetMove || t.hasDirFlip);
  const toneColor = consensus!.tone === "bull" ? "var(--bull)" : consensus!.tone === "bear" ? "var(--bear)" : "var(--neu)";

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">Institutional Consensus · {asset.assetClass}</div>
        <h1>{asset.name}</h1>
        <div className="big-score">
          <span className="num" style={{ color: toneColor }}>{consensus!.score}</span>
          <span className="mono" style={{ color: "var(--muted)" }}>/ 100</span>
          <span className={`chip ${consensus!.tone}`}>{consensus!.label}</span>
        </div>
        <div className="deltas">
          <span>1D <Delta v={d1} /></span>
          <span>7D <Delta v={d7} /></span>
          <span>30D <Delta v={d30} /></span>
          <span style={{ color: "var(--faint)" }}>{consensus!.institutionCount} institutions · {consensus!.bullishCount}↑ {consensus!.neutralCount}→ {consensus!.bearishCount}↓</span>
        </div>
        <form action={addWatch} style={{ alignSelf: "flex-start" }}>
          <input type="hidden" name="kind" value="asset" />
          <input type="hidden" name="refId" value={asset.ticker} />
          <input type="hidden" name="back" value={`/asset/${asset.ticker}`} />
          <button type="submit" className="minibtn">＋ Watch</button>
        </form>
      </div>

      <section className="blk">
        <div className="section-t">Institutional Views</div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Institution</th><th>Direction</th><th>Target</th><th>Previous</th><th>Updated</th></tr></thead>
            <tbody>
              {consensus!.contributors.map((c, i) => (
                <tr key={i}>
                  <td className="inst"><Link href={`/institution/${c.slug}`}>{c.institutionName}</Link></td>
                  <td><DirChip direction={c.direction} showLabel={false} /></td>
                  <td className="mono-cell">{c.target ? `$${c.target.toLocaleString()}` : "—"}</td>
                  <td className="mono-cell" style={{ color: "var(--faint)" }}>{c.previousTarget ? `$${c.previousTarget.toLocaleString()}` : "—"}</td>
                  <td className="mono-cell">{relTime(c.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {timeline.length > 0 && (
        <section className="blk">
          <div className="section-t">Recent View Changes</div>
          <div className="changes">
            {timeline.map((t) => (
              <div key={t.slug} className="chg">
                <Link href={`/institution/${t.slug}`} className="chg-inst">{t.institution}</Link>
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
                          <span className={`chip ${d.tone}`}>{d.label}</span>
                          {i < t.dirChain.length - 1 && <span className="arw">→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{relTime(t.lastChange)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {dist && (
        <section className="blk">
          <div className="section-t">Target Distribution</div>
          <div className="dist">
            <div className="stat"><span>Lowest</span><b>${dist.low.toLocaleString()}</b></div>
            <div className="stat"><span>Median</span><b>${dist.median.toLocaleString()}</b></div>
            <div className="stat"><span>Average</span><b>${dist.avg.toLocaleString()}</b></div>
            <div className="stat"><span>Highest</span><b className="up">${dist.high.toLocaleString()}</b></div>
          </div>
        </section>
      )}

      <section style={{ paddingTop: 26 }}>
        <div className="section-t">Related Research</div>
        <div className="feed">
          {articles.map((a) => <FeedCard key={a.id} a={a} />)}
        </div>
      </section>
    </main>
  );
}
