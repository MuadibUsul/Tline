import Link from "next/link";
import { featuredConsensus, latestFeed, mostActive, viewChanges } from "@/lib/queries";
import { FeedCard, Delta } from "./_components/ui";
import SearchBox from "./_components/SearchBox";
import { assetName, domainTerm, formatDate, getLocale, institutionName, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

export default async function Home() {
  const locale = await getLocale();
  const [cards, feed, active, changes] = await Promise.all([
    featuredConsensus(),
    latestFeed(8),
    mostActive(30, 6),
    viewChanges(6),
  ]);

  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">{tr(locale, "Global Institutional Intelligence", "全球机构情报")}</div>
        <h1>{locale === "zh-CN" ? <>追踪全球顶尖<br />机构的<em>观点。</em></> : <>Track what the world&apos;s leading<br />institutions <em>think.</em></>}</h1>
        <p className="sub">{tr(locale, "Turn the research produced daily by global financial institutions into comparable, trackable and searchable signals.", "把全球金融机构每天产生的研报，转换成可比较、可追踪、可检索的信号。")}</p>
        <SearchBox locale={locale} placeholder={tr(locale, "Search institutions, assets and research…", "搜索机构、资产和研报……")} ariaLabel={tr(locale, "Search the site", "全站搜索")} />
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Market Consensus · current or latest available 24h", "市场共识 · 当前或最近可用24小时")}</div>
        <div className="ctiles">
          {cards.map((c) => (
            <Link key={c.ticker} href={`/asset/${c.ticker}`} className="ctile">
              <div className="a">{assetName(c.name, locale, c.ticker)}</div>
              <div className="s tnum">
                {c.score}
                <span className={`dir ${c.tone === "bull" ? "up" : c.tone === "bear" ? "down" : "flat"}`}>
                  {c.tone === "bull" ? "↑" : c.tone === "bear" ? "↓" : "→"} {c.tone === "bull" ? tr(locale, c.label, "看多") : c.tone === "bear" ? tr(locale, c.label, "看空") : tr(locale, c.label, "中性")}
                </span>
              </div>
              <div className="bar"><i style={{ width: `${c.score}%`, background: TONE[c.tone] }} /></div>
              <div className="meta">
                <span>1D&nbsp;<Delta v={c.d1} /></span>
                <span>7D&nbsp;<Delta v={c.d7} /></span>
                <span>30D&nbsp;<Delta v={c.d30} /></span>
                {c.isFallback && <span>{tr(locale, `as of ${formatDate(c.windowEnd, locale)}`, `截至 ${formatDate(c.windowEnd, locale)}`)}</span>}
              </div>
            </Link>
          ))}
          {cards.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No market data yet.", "暂无市场数据。")}</p>}
        </div>
      </section>

      <div className="grid-main">
        <div>
          <div className="section-t">{tr(locale, "Latest Institutional Views", "最新机构观点")}</div>
          <div className="feed">
            {feed.map((a) => <FeedCard key={a.id} a={a} locale={locale} />)}
          </div>
        </div>
        <div>
          <div className="side-block">
            <div className="section-t">{tr(locale, "Largest View Changes · 24h", "最大观点变化 · 24小时")}</div>
            <div className="rowlist">
              {changes.map((c) => (
                <Link key={c.ticker} href={`/asset/${c.ticker}`} className="r" style={{ textDecoration: "none" }}>
                  <span className="inst">{assetName(c.name, locale, c.ticker)}</span>
                  <span className={`n ${c.change > 0 ? "up" : "down"}`}>{c.change > 0 ? "+" : "−"}{Math.abs(c.change)}</span>
                </Link>
              ))}
              {changes.length === 0 && <div className="r"><span style={{ color: "var(--muted)" }}>—</span></div>}
            </div>
          </div>
          <div className="side-block">
            <div className="section-t">{tr(locale, "Most Active · 30d", "最活跃机构 · 30天")}</div>
            <div className="rowlist">
              {active.map((x) => (
                <Link key={x.inst.id} href={`/institution/${x.inst.slug}`} className="r">
                  <span className="inst">{institutionName(x.inst.name, locale)}</span>
                  <span className="n">{x.count}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="side-block">
            <div className="section-t">{tr(locale, "Trending Topics", "热门话题")}</div>
            <div className="tag-row">
              {["Fed", "AI Capex", "Nvidia", "Gold", "Oil", "USD", "Treasuries", "China"].map((t) => (
                <span key={t} className="chip gray">{domainTerm(t, locale)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
