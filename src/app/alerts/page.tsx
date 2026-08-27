import Link from "next/link";
import { getAlertsView } from "@/lib/user";
import { getSessionUser } from "@/lib/auth";
import { describeRule } from "@/lib/alerts";
import { relTime } from "@/app/_components/ui";
import { createRule, toggleRule, deleteRule } from "@/app/actions";
import { ASSETS } from "@/lib/assets";
import { getLocale, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const FEATURED = ASSETS.filter((a) => a.featured);

export default async function AlertsPage() {
  const locale = getLocale();
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="wrap" style={{ maxWidth: 520 }}>
        <div className="page-head"><div className="eyebrow">{tr(locale, "Alerts", "提醒")}</div><h1>{tr(locale, "Sign in to set alerts", "登录后设置提醒")}</h1>
          <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Get notified when institutional consensus crosses your thresholds.", "当机构共识跨越设定阈值时接收提醒。")}</p>
          <Link href="/signin?next=/alerts" className="minibtn p" style={{ alignSelf: "flex-start", padding: "9px 14px" }}>{tr(locale, "Sign in", "登录")} →</Link>
        </div>
      </main>
    );
  }
  const { rules, events } = await getAlertsView(user.id);

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Signal Monitoring", "信号监控")}</div>
        <h1>{tr(locale, "Alerts", "提醒")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {tr(locale, "Consensus rules are evaluated on every snapshot.", "每次生成快照时都会评估共识规则。")} <Link href="/watchlist">← {tr(locale, "Watchlist", "关注列表")}</Link>
        </p>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "New rule", "新建规则")}</div>
        <form action={createRule} className="rule-form">
          <label className="field"><span>{tr(locale, "Type", "类型")}</span>
            <select name="type" defaultValue="CONSENSUS_ABOVE">
              <option value="CONSENSUS_ABOVE">{tr(locale, "Consensus ≥", "共识 ≥")}</option>
              <option value="CONSENSUS_BELOW">{tr(locale, "Consensus ≤", "共识 ≤")}</option>
              <option value="CONSENSUS_DROP_24H">{tr(locale, "Drops (24h) ≥", "24小时下降 ≥")}</option>
              <option value="CONSENSUS_RISE_24H">{tr(locale, "Rises (24h) ≥", "24小时上升 ≥")}</option>
            </select>
          </label>
          <label className="field"><span>{tr(locale, "Asset", "资产")}</span>
            <select name="assetTicker" defaultValue="">
              <option value="">{tr(locale, "Any featured", "任一精选资产")}</option>
              {FEATURED.map((a) => <option key={a.ticker} value={a.ticker}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span>{tr(locale, "Value", "数值")}</span>
            <input name="threshold" type="number" defaultValue={80} min={0} max={100} />
          </label>
          <button type="submit" className="minibtn p" style={{ padding: "9px 14px" }}>{tr(locale, "Add rule", "添加规则")}</button>
        </form>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Rules", "规则")} · {rules.length}</div>
        <div className="rowlist">
          {rules.map((r) => (
            <div key={r.id} className="r">
              <span>
                <b style={{ color: "var(--ink)" }}>{r.name}</b>
                <span className="mono" style={{ color: "var(--muted)", marginLeft: 8, fontSize: 12 }}>{describeRule(r, locale)}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <form action={toggleRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className={`chip ${r.active ? "acc" : "gray"}`} style={{ border: "none", cursor: "pointer" }}>
                    {r.active ? tr(locale, "active", "启用") : tr(locale, "paused", "暂停")}
                  </button>
                </form>
                <form action={deleteRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="iconbtn" title={tr(locale, "Delete", "删除")}>✕</button>
                </form>
              </span>
            </div>
          ))}
          {rules.length === 0 && <div className="r"><span style={{ color: "var(--muted)" }}>{tr(locale, "No rules yet — add one above.", "暂无规则，请在上方添加。")}</span></div>}
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="section-t">{tr(locale, "Triggered · recent", "近期触发")}</div>
        <div className="feed">
          {events.map((e) => (
            <div key={e.id} className="fcard">
              <div className="top">
                <b>{e.rule.name}</b> · <span>{relTime(e.firedAt, locale)}</span>
                {e.assetTicker && <Link href={`/asset/${e.assetTicker}`} className="chip gray" style={{ marginLeft: "auto" }}>{e.assetTicker}</Link>}
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--ink-2)" }}>{e.message}</div>
            </div>
          ))}
          {events.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No alerts fired yet.", "尚未触发提醒。")}</p>}
        </div>
      </section>
    </main>
  );
}
