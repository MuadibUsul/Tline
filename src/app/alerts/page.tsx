import Link from "next/link";
import { getAlertsView } from "@/lib/user";
import { getSessionUser } from "@/lib/auth";
import { describeRule } from "@/lib/alerts";
import { relTime } from "@/app/_components/ui";
import { createRule, toggleRule, deleteRule } from "@/app/actions";
import { ASSETS } from "@/lib/assets";

export const dynamic = "force-dynamic";

const FEATURED = ASSETS.filter((a) => a.featured);

export default async function AlertsPage() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="wrap" style={{ maxWidth: 520 }}>
        <div className="page-head"><div className="eyebrow">Alerts</div><h1>Sign in to set alerts</h1>
          <p className="sub" style={{ color: "var(--muted)" }}>Get notified when institutional consensus crosses your thresholds.</p>
          <Link href="/signin?next=/alerts" className="minibtn p" style={{ alignSelf: "flex-start", padding: "9px 14px" }}>Sign in →</Link>
        </div>
      </main>
    );
  }
  const { rules, events } = await getAlertsView(user.id);

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">Signal Monitoring</div>
        <h1>Alerts</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          Consensus rules evaluated on every snapshot. <Link href="/watchlist">← Watchlist</Link>
        </p>
      </div>

      <section className="blk">
        <div className="section-t">New rule</div>
        <form action={createRule} className="rule-form">
          <label className="field"><span>Type</span>
            <select name="type" defaultValue="CONSENSUS_ABOVE">
              <option value="CONSENSUS_ABOVE">Consensus ≥</option>
              <option value="CONSENSUS_BELOW">Consensus ≤</option>
              <option value="CONSENSUS_DROP_24H">Drops (24h) ≥</option>
              <option value="CONSENSUS_RISE_24H">Rises (24h) ≥</option>
            </select>
          </label>
          <label className="field"><span>Asset</span>
            <select name="assetTicker" defaultValue="">
              <option value="">Any featured</option>
              {FEATURED.map((a) => <option key={a.ticker} value={a.ticker}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Value</span>
            <input name="threshold" type="number" defaultValue={80} min={0} max={100} />
          </label>
          <button type="submit" className="minibtn p" style={{ padding: "9px 14px" }}>Add rule</button>
        </form>
      </section>

      <section className="blk">
        <div className="section-t">Rules · {rules.length}</div>
        <div className="rowlist">
          {rules.map((r) => (
            <div key={r.id} className="r">
              <span>
                <b style={{ color: "var(--ink)" }}>{r.name}</b>
                <span className="mono" style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>{describeRule(r)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <form action={toggleRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={`chip ${r.active ? "acc" : "gray"}`} style={{ border: "none", cursor: "pointer" }}>
                    {r.active ? "active" : "paused"}
                  </button>
                </form>
                <form action={deleteRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="iconbtn" title="Delete">✕</button>
                </form>
              </span>
            </div>
          ))}
          {rules.length === 0 && <div className="r"><span style={{ color: "var(--muted)" }}>No rules yet — add one above.</span></div>}
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="section-t">Triggered · recent</div>
        <div className="feed">
          {events.map((e) => (
            <div key={e.id} className="fcard">
              <div className="top">
                <b>{e.rule.name}</b> · <span>{relTime(e.firedAt)} ago</span>
                {e.assetTicker && <Link href={`/asset/${e.assetTicker}`} className="chip gray" style={{ marginLeft: "auto" }}>{e.assetTicker}</Link>}
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--ink-2)" }}>{e.message}</div>
            </div>
          ))}
          {events.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>No alerts fired yet.</p>}
        </div>
      </section>
    </main>
  );
}
