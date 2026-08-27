import Link from "next/link";
import { getWatchlistView } from "@/lib/user";
import { getSessionUser } from "@/lib/auth";
import { Delta } from "@/app/_components/ui";
import { removeWatch } from "@/app/actions";
import { getLocale, tr, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

function SignInGate({ locale }: { locale: Locale }) {
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="page-head"><div className="eyebrow">{tr(locale, "Watchlist", "关注列表")}</div><h1>{tr(locale, "Sign in to build a watchlist", "登录后创建关注列表")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Track assets and institutions, and get consensus alerts.", "关注资产和机构，并接收共识提醒。")}</p>
        <Link href="/signin?next=/watchlist" className="minibtn p" style={{ alignSelf: "flex-start", padding: "9px 14px" }}>{tr(locale, "Sign in", "登录")} →</Link>
      </div>
    </main>
  );
}

export default async function WatchlistPage() {
  const locale = getLocale();
  const user = await getSessionUser();
  if (!user) return <SignInGate locale={locale} />;
  const { assets, institutions } = await getWatchlistView(user.id);

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{user.tier.toUpperCase()}</div>
        <h1>{tr(locale, "Watchlist", "关注列表")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {user.name} · {user.email} · <Link href="/alerts">{tr(locale, "Manage alerts", "管理提醒")} →</Link>
        </p>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Assets", "资产")}</div>
        <div className="ctiles">
          {assets.map((a) => (
            <div key={a.ticker} className="ctile" style={{ position: "relative" }}>
              <form action={removeWatch} style={{ position: "absolute", top: 8, right: 8 }}>
                <input type="hidden" name="kind" value="asset" />
                <input type="hidden" name="refId" value={a.ticker} />
                <button className="iconbtn" title={tr(locale, "Remove", "移除")} type="submit">✕</button>
              </form>
              <Link href={`/asset/${a.ticker}`} style={{ display: "block" }}>
                <div className="a">{a.name}</div>
                <div className="s tnum">
                  {a.score}
                  <span className={`dir ${a.tone === "bull" ? "up" : a.tone === "bear" ? "down" : "flat"}`}>
                    {a.tone === "bull" ? "↑" : a.tone === "bear" ? "↓" : "→"} {a.tone === "bull" ? tr(locale, a.label, "看多") : a.tone === "bear" ? tr(locale, a.label, "看空") : tr(locale, a.label, "中性")}
                  </span>
                </div>
                <div className="bar"><i style={{ width: `${a.score}%`, background: TONE[a.tone] }} /></div>
                <div className="meta"><span>24h&nbsp;<Delta v={a.d1} /></span></div>
              </Link>
            </div>
          ))}
          {assets.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No assets yet — open any asset page and click ＋ Watch.", "暂无资产，请打开任一资产页并点击“＋ 关注”。")}</p>}
        </div>
      </section>

      {institutions.length > 0 && (
        <section style={{ paddingTop: 22 }}>
          <div className="section-t">{tr(locale, "Institutions", "机构")}</div>
          <div className="rowlist">
            {institutions.map((i) => (
              <div key={i.id} className="r">
                <Link href={`/institution/${i.slug}`} className="inst">{i.name}</Link>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="stars" style={{ fontSize: 12 }}>{"★".repeat(i.rating)}</span>
                  <form action={removeWatch}>
                    <input type="hidden" name="kind" value="institution" />
                    <input type="hidden" name="refId" value={i.slug} />
                    <button className="iconbtn" title={tr(locale, "Remove", "移除")} type="submit">✕</button>
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
