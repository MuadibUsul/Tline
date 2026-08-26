import Link from "next/link";
import { getWatchlistView } from "@/lib/user";
import { getSessionUser } from "@/lib/auth";
import { Delta } from "@/app/_components/ui";
import { removeWatch } from "@/app/actions";

export const dynamic = "force-dynamic";
const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

function SignInGate() {
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="page-head"><div className="eyebrow">Watchlist</div><h1>Sign in to build a watchlist</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>Track assets and institutions, and get consensus alerts.</p>
        <Link href="/signin?next=/watchlist" className="minibtn p" style={{ alignSelf: "flex-start", padding: "9px 14px" }}>Sign in →</Link>
      </div>
    </main>
  );
}

export default async function WatchlistPage() {
  const user = await getSessionUser();
  if (!user) return <SignInGate />;
  const { assets, institutions } = await getWatchlistView(user.id);

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{user.tier.toUpperCase()}</div>
        <h1>Watchlist</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {user.name} · {user.email} · <Link href="/alerts">Manage alerts →</Link>
        </p>
      </div>

      <section className="blk">
        <div className="section-t">Assets</div>
        <div className="ctiles">
          {assets.map((a) => (
            <div key={a.ticker} className="ctile" style={{ position: "relative" }}>
              <form action={removeWatch} style={{ position: "absolute", top: 8, right: 8 }}>
                <input type="hidden" name="kind" value="asset" />
                <input type="hidden" name="refId" value={a.ticker} />
                <button className="iconbtn" title="Remove" type="submit">✕</button>
              </form>
              <Link href={`/asset/${a.ticker}`} style={{ display: "block" }}>
                <div className="a">{a.name}</div>
                <div className="s tnum">
                  {a.score}
                  <span className={`dir ${a.tone === "bull" ? "up" : a.tone === "bear" ? "down" : "flat"}`}>
                    {a.tone === "bull" ? "↑" : a.tone === "bear" ? "↓" : "→"} {a.label}
                  </span>
                </div>
                <div className="bar"><i style={{ width: `${a.score}%`, background: TONE[a.tone] }} /></div>
                <div className="meta"><span>24h&nbsp;<Delta v={a.d1} /></span></div>
              </Link>
            </div>
          ))}
          {assets.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>No assets yet — open any asset page and click ＋ Watch.</p>}
        </div>
      </section>

      {institutions.length > 0 && (
        <section style={{ paddingTop: 22 }}>
          <div className="section-t">Institutions</div>
          <div className="rowlist">
            {institutions.map((i) => (
              <div key={i.id} className="r">
                <Link href={`/institution/${i.slug}`} className="inst">{i.name}</Link>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="stars" style={{ fontSize: 12 }}>{"★".repeat(i.rating)}</span>
                  <form action={removeWatch}>
                    <input type="hidden" name="kind" value="institution" />
                    <input type="hidden" name="refId" value={i.slug} />
                    <button className="iconbtn" title="Remove" type="submit">✕</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
