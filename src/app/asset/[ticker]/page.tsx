import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssetView, getAssetTimeline } from "@/lib/queries";
import { FeedCard, DirChip, Delta, relTime } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";
import { assetName, domainTerm, formatDate, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { assetSeoTitle, breadcrumbJsonLd, canonical, datasetJsonLd, JsonLd, localizedUrl, ogImage, webPageJsonLd } from "@/lib/seo";
import { assetPath, tickerFromAssetSlug } from "@/lib/assetPath";
import { publicationReadyWhere } from "@/lib/publication";
import { getAssetMarketSnapshot } from "@/lib/macro/market/read";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await props.params;
  const locale = await getLocale();
  const asset = await prisma.asset.findUnique({
    where: { ticker: tickerFromAssetSlug(ticker) },
    select: {
      ticker: true, name: true,
      articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true } } } },
    },
  });
  if (!asset) return { title: tr(locale, "Asset not found", "资产未找到") };
  const name = assetName(asset.name, locale, asset.ticker);
  const institutionCount = new Set(asset.articleAssets.map((item) => item.article.institutionId)).size;
  return {
    title: { absolute: assetSeoTitle(name, locale) },
    description: tr(
      locale,
      institutionCount >= 2 ? `Cross-institution outlook and recent source-linked views on ${name} (${asset.ticker}).` : `Source-linked institutional research and recent views on ${name} (${asset.ticker}).`,
      institutionCount >= 2 ? `${name}（${asset.ticker}）的跨机构展望与近期可溯源观点。` : `${name}（${asset.ticker}）的机构公开研报与近期观点。`,
    ),
    ...canonical(assetPath(asset.ticker), locale),
    ...(institutionCount < 2 ? { robots: { index: false, follow: true } } : {}),
    openGraph: { url: localizedUrl(assetPath(asset.ticker), locale), locale, images: [{ url: ogImage("Asset Intelligence", `${asset.name} - ${asset.ticker}`), width: 1200, height: 630 }] },
  };
}


export default async function AssetPage(props: { params: Promise<{ ticker: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getAssetView(tickerFromAssetSlug(params.ticker));
  if (!data) notFound();
  const { asset, consensus, d1, d7, d30, dist, articles } = data;
  const [timelineRows, market] = await Promise.all([getAssetTimeline(asset.id), getAssetMarketSnapshot(asset.ticker)]);
  const timeline = timelineRows.filter((t) => t.hasTargetMove || t.hasDirFlip);
  const toneColor = consensus?.tone === "bull" ? "var(--bull)" : consensus?.tone === "bear" ? "var(--bear)" : "var(--neu)";
  const marketSeries = market.available ? market.history.map((row) => Number(row.close)).filter(Number.isFinite) : [];
  const marketMin = marketSeries.length ? Math.min(...marketSeries) : 0;
  const marketRange = marketSeries.length ? Math.max(...marketSeries) - marketMin || 1 : 1;
  const marketPoints = marketSeries.map((value, index) => `${marketSeries.length === 1 ? 0 : index / (marketSeries.length - 1) * 100},${40 - (value - marketMin) / marketRange * 36}`).join(" ");

  return (
    <main className="wrap">
      <JsonLd data={webPageJsonLd(locale, assetPath(asset.ticker), assetName(asset.name, locale, asset.ticker), tr(locale, `Cross-institution views and consensus for ${asset.name}.`, `${assetName(asset.name, locale, asset.ticker)}的跨机构观点与共识。`))} />
      {consensus && consensus.institutionCount >= 2 && <JsonLd data={datasetJsonLd(locale, assetPath(asset.ticker), tr(locale, `${asset.name} institutional consensus`, `${assetName(asset.name, locale, asset.ticker)}机构共识`), tr(locale, "Authority-weighted, time-decayed public institutional views.", "按权威度加权并经时间衰减的公开机构观点。"), consensus.windowEnd)} />}
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Markets", "资产市场"), path: "/markets" }, { name: assetName(asset.name, locale, asset.ticker), path: assetPath(asset.ticker) }])} />
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}><Link href={localePath(locale, "/markets")}>{tr(locale, "Markets", "资产市场")}</Link><span>›</span><span>{assetName(asset.name, locale, asset.ticker)}</span></nav>
      <div className="page-head">
        <div className="eyebrow">{consensus?.isFallback ? tr(locale, `Institutional Consensus · latest available 24h · as of ${formatDate(consensus.windowEnd, locale)}`, `机构共识 · 最近可用24小时 · 截至 ${formatDate(consensus.windowEnd, locale)}`) : tr(locale, "Institutional Consensus · last 24h", "机构共识 · 最近24小时")} · {domainTerm(asset.assetClass, locale)}</div>
        <h1>{assetName(asset.name, locale, asset.ticker)}</h1>
        {consensus && consensus.institutionCount >= 2 ? <>
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
        </> : consensus ? <div className="deltas"><span>{tr(locale, "Direction", "方向")} <b>{consensus.tone === "bull" ? tr(locale, "Bullish", "看多") : consensus.tone === "bear" ? tr(locale, "Bearish", "看空") : tr(locale, "Neutral", "中性")}</b></span><span>{tr(locale, "Coverage", "覆盖")} <b>{consensus.institutionCount} {tr(locale, "institution", "家机构")}</b></span><span>{tr(locale, "Confidence: insufficient coverage", "置信说明：覆盖不足")}</span><span>{tr(locale, "Freshness", "数据时间")} {formatDate(consensus.windowEnd, locale)}</span></div> : <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "No institutional view has been recorded for this asset yet.", "该资产尚未收录任何机构观点。")}</p>}
        <form action={addWatch} style={{ alignSelf: "flex-start" }}>
          <input type="hidden" name="kind" value="asset" />
          <input type="hidden" name="refId" value={asset.ticker} />
          <input type="hidden" name="back" value={assetPath(asset.ticker)} />
          <button type="submit" className="minibtn">＋ {tr(locale, "Watch", "关注")}</button>
        </form>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Market observation", "行情观测")}</div>
        {market.available ? <>
          <div className="deltas">
            <span>{tr(locale, "Latest", "最新")} <b className="mono">{Number(market.observation.close).toLocaleString()} {market.observation.quoteCurrency}</b></span>
            <span>{market.observation.priceType.toLowerCase()} · {market.observation.interval}</span>
            <span>{market.observation.provider} · {market.observation.quality.toLowerCase()}</span>
            <span>{tr(locale, "As of", "截至")} {formatDate(market.observation.observedAt, locale)}</span>
            <span>{tr(locale, "Provider delay", "供应商声明延迟")} {market.decision.providerDelaySeconds === null ? tr(locale, "not declared", "未声明") : `${market.decision.providerDelaySeconds}s`}</span>
            <span>{tr(locale, "Site sampling", "本站采样")} {market.decision.samplingIntervalSeconds}s</span>
          </div>
          {marketPoints && <svg viewBox="0 0 100 42" role="img" aria-label={tr(locale, "Same-source 30-day price history", "同来源30日价格历史")} style={{ width: "100%", maxHeight: 180, marginTop: 18 }}><polyline points={marketPoints} fill="none" stroke="var(--accent)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" /></svg>}
        </> : <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, `Price unavailable: ${market.reason.replaceAll("_", " ")}. Research content remains available.`, `行情不可用：${market.reason === "authorization_pending" ? "授权依据待确认" : market.reason === "stale" ? "数据已过期" : market.reason === "unsupported" ? "暂无匹配标的" : "暂无合格数据"}。研报内容不受影响。`)}</p>}
      </section>

      {consensus && <section className="blk">
        <div className="section-t">{consensus.isFallback ? tr(locale, "Institutional Views · latest available 24h", "机构观点 · 最近可用24小时") : tr(locale, "Institutional Views · last 24h", "机构观点 · 最近24小时")}</div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Institution", "机构")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Target", "目标价")}</th><th>{tr(locale, "Previous", "此前")}</th><th>{tr(locale, "Updated", "更新于")}</th></tr></thead>
            <tbody>
              {consensus.contributors.map((c, i) => (
                <tr key={i}>
                  <td className="inst"><Link href={localePath(locale, `/institution/${c.slug}`)}>{institutionName(c.institutionName, locale)}</Link></td>
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
                <Link href={localePath(locale, `/institution/${t.slug}`)} className="chg-inst">{institutionName(t.institution, locale)}</Link>
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
