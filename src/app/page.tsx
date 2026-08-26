import Link from "next/link";
import { featuredConsensus, latestFeed, mostActive, viewChanges } from "@/lib/queries";
import { FeedCard, Delta } from "./_components/ui";
import SearchBox from "./_components/SearchBox";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

export default async function Home() {
  const [cards, feed, active, changes] = await Promise.all([
    featuredConsensus(),
    latestFeed(8),
    mostActive(30, 6),
    viewChanges(6),
  ]);

  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">Global Institutional Intelligence</div>
        <h1>Track what the world&apos;s leading<br />institutions <em>think.</em></h1>
        <p className="sub">把全球金融机构每天产生的 Research，转换成可比较、可追踪、可检索的 Signal。</p>
        <SearchBox />
      </section>

      <section className="blk">
        <div className="section-t">Market Consensus</div>
        <div className="ctiles">
          {cards.map((c) => (
            <Link key={c.ticker} href={`/asset/${c.ticker}`} className="ctile">
              <div className="a">{c.name}</div>
              <div className="s tnum">
                {c.score}
                <span className={`dir ${c.tone === "bull" ? "up" : c.tone === "bear" ? "down" : "flat"}`}>
                  {c.tone === "bull" ? "↑" : c.tone === "bear" ? "↓" : "→"} {c.label}
                </span>
              </div>
              <div className="bar"><i style={{ width: `${c.score}%`, background: TONE[c.tone] }} /></div>
              <div className="meta">
                <span>1D&nbsp;<Delta v={c.d1} /></span>
                <span>7D&nbsp;<Delta v={c.d7} /></span>
                <span>30D&nbsp;<Delta v={c.d30} /></span>
              </div>
            </Link>
          ))}
          {cards.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>No data yet — run <code>npm run setup</code>.</p>}
        </div>
      </section>

      <div className="grid-main">
        <div>
          <div className="section-t">Latest Institutional Views</div>
          <div className="feed">
            {feed.map((a) => <FeedCard key={a.id} a={a} />)}
          </div>
        </div>
        <div>
          <div className="side-block">
            <div className="section-t">Largest View Changes · 24h</div>
            <div className="rowlist">
              {changes.map((c) => (
                <Link key={c.ticker} href={`/asset/${c.ticker}`} className="r" style={{ textDecoration: "none" }}>
                  <span className="inst">{c.name}</span>
                  <span className={`n ${c.change > 0 ? "up" : "down"}`}>{c.change > 0 ? "+" : "−"}{Math.abs(c.change)}</span>
                </Link>
              ))}
              {changes.length === 0 && <div className="r"><span style={{ color: "var(--muted)" }}>—</span></div>}
            </div>
          </div>
          <div className="side-block">
            <div className="section-t">Most Active · 30d</div>
            <div className="rowlist">
              {active.map((x) => (
                <Link key={x.inst.id} href={`/institution/${x.inst.slug}`} className="r">
                  <span className="inst">{x.inst.name}</span>
                  <span className="n">{x.count}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="side-block">
            <div className="section-t">Trending Topics</div>
            <div className="tag-row">
              {["Fed", "AI Capex", "Nvidia", "Gold", "Oil", "USD", "Treasuries", "China"].map((t) => (
                <span key={t} className="chip gray">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
