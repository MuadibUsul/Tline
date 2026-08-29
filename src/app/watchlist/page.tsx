import Link from "next/link";
import { getWatchlistView, getAlertsView } from "@/lib/user";
import { getSessionUser } from "@/lib/auth";
import { Delta, relTime } from "@/app/_components/ui";
import { addWatch, removeWatch, toggleRule, deleteRule } from "@/app/actions";
import MonitoringRuleForm from "@/app/_components/MonitoringRuleForm";
import { describeRule } from "@/lib/alerts";
import { prisma } from "@/lib/db";
import { assetName, formatDate, getLocale, institutionName, localeSafeText, tr, type Locale } from "@/lib/i18n";

export const dynamic = "force-dynamic";
const TONE: Record<string, string> = { bull: "var(--bull)", bear: "var(--bear)", neu: "var(--neu)" };

function SignInGate({ locale }: { locale: Locale }) {
  return (
    <main className="wrap" style={{ maxWidth: 560 }}>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Monitoring Center", "监控中心")}</div>
        <h1>{tr(locale, "Sign in to monitor the market", "登录后建立市场监控")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Track assets, institutions, themes and consensus signals in one place.", "在同一处关注资产、机构、交易主线与共识信号。")}</p>
        <Link href="/signin?next=/watchlist" className="minibtn p" style={{ alignSelf: "flex-start", padding: "9px 14px" }}>{tr(locale, "Sign in", "登录")} →</Link>
      </div>
    </main>
  );
}

function RemoveButton({ kind, refId, locale }: { kind: string; refId: string; locale: Locale }) {
  return (
    <form action={removeWatch}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="refId" value={refId} />
      <button className="iconbtn" title={tr(locale, "Remove", "移除")} type="submit">✕</button>
    </form>
  );
}

export default async function WatchlistPage() {
  const locale = getLocale();
  const user = await getSessionUser();
  if (!user) return <SignInGate locale={locale} />;

  const [{ assets, institutions, themes }, { rules, events }, allAssets, allInstitutions] = await Promise.all([
    getWatchlistView(user.id), getAlertsView(user.id),
    prisma.asset.findMany({ orderBy: { name: "asc" }, select: { ticker: true, name: true } }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { slug: true, name: true } }),
  ]);
  const eventArticles = events.some((event) => event.targetId) ? await prisma.article.findMany({
    where: { id: { in: events.flatMap((event) => event.targetId ? [event.targetId] : []) } },
    select: { id: true, title: true, institution: { select: { name: true } }, translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } } },
  }) : [];
  const eventArticleById = new Map(eventArticles.map((article) => [article.id, article]));
  const assetOptions = allAssets.map((asset) => ({ value: asset.ticker, label: `${assetName(asset.name, locale, asset.ticker)} · ${asset.ticker}` }));
  const institutionOptions = allInstitutions.map((institution) => ({ value: institution.slug, label: institutionName(institution.name, locale) }));
  const alertMessage = (event: (typeof events)[number]) => {
    const article = event.targetId ? eventArticleById.get(event.targetId) : undefined;
    if (article) return `${institutionName(article.institution.name, locale)}: ${locale === "zh-CN" ? article.translations[0]?.title ?? "中文译文待处理" : article.title}`;
    const asset = event.assetTicker ? allAssets.find((item) => item.ticker === event.assetTicker) : undefined;
    if (asset) return `${assetName(asset.name, locale, asset.ticker)} ${tr(locale, "consensus", "共识")} ${event.score ?? "—"}`;
    return describeRule(event.rule, locale);
  };

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Signal Monitoring", "信号监控")}</div>
        <h1>{tr(locale, "Monitoring Center", "监控中心")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, "Follow what matters, then define exactly when it should surface.", "先关注重要对象，再定义何时需要提醒。")}</p>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Add monitoring target", "添加监控对象")}</div>
        <div className="monitor-add-grid">
          <form action={addWatch} className="monitor-add-card"><input type="hidden" name="kind" value="asset" /><label className="field"><span>{tr(locale, "Asset", "资产")}</span><select name="refId" required>{assetOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="minibtn p">{tr(locale, "Follow", "关注")}</button></form>
          <form action={addWatch} className="monitor-add-card"><input type="hidden" name="kind" value="institution" /><label className="field"><span>{tr(locale, "Institution", "机构")}</span><select name="refId" required>{institutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="minibtn p">{tr(locale, "Follow", "关注")}</button></form>
          <form action={addWatch} className="monitor-add-card"><input type="hidden" name="kind" value="theme" /><label className="field"><span>{tr(locale, "Trading theme", "交易主线")}</span><input name="refId" maxLength={80} placeholder={tr(locale, "e.g. AI capex", "例如：AI 资本开支")} required /></label><button className="minibtn p">{tr(locale, "Follow", "关注")}</button></form>
        </div>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Followed assets", "已关注资产")} · {assets.length}</div>
        <div className="ctiles">
          {assets.map((asset) => (
            <div key={asset.ticker} className="ctile monitor-asset">
              <div className="monitor-remove"><RemoveButton kind="asset" refId={asset.ticker} locale={locale} /></div>
              <Link href={`/asset/${asset.ticker}`} style={{ display: "block" }}>
                <div className="a">{assetName(asset.name, locale, asset.ticker)}</div>
                {asset.score === null || asset.tone === null || asset.label === null ? <><div className="s tnum">—</div><div className="meta"><span>{tr(locale, "No consensus in the latest 24h", "最近24小时暂无共识")}</span></div></> : <>
                  <div className="s tnum">{asset.score}<span className={`dir ${asset.tone === "bull" ? "up" : asset.tone === "bear" ? "down" : "flat"}`}>{asset.tone === "bull" ? "↑" : asset.tone === "bear" ? "↓" : "→"} {tr(locale, asset.label, asset.tone === "bull" ? "看多" : asset.tone === "bear" ? "看空" : "中性")}</span></div>
                  <div className="bar"><i style={{ width: `${asset.score}%`, background: TONE[asset.tone] }} /></div><div className="meta"><span>24h&nbsp;<Delta v={asset.d1} /></span>{asset.isFallback && asset.windowEnd && <span>{tr(locale, "as of", "截至")} {formatDate(asset.windowEnd, locale)}</span>}</div>
                </>}
              </Link>
            </div>
          ))}
          {assets.length === 0 && <p className="mono monitor-empty">{tr(locale, "No followed assets yet.", "尚未关注资产。")}</p>}
        </div>
        <div className="monitor-object-grid">
          <div><div className="section-t">{tr(locale, "Institutions", "机构")} · {institutions.length}</div><div className="rowlist">{institutions.map((institution) => <div key={institution.id} className="r"><Link href={`/institution/${institution.slug}`} className="inst">{institutionName(institution.name, locale)}</Link><RemoveButton kind="institution" refId={institution.slug} locale={locale} /></div>)}{institutions.length === 0 && <div className="r monitor-empty">{tr(locale, "No followed institutions.", "尚未关注机构。")}</div>}</div></div>
          <div><div className="section-t">{tr(locale, "Trading themes", "交易主线")} · {themes.length}</div><div className="rowlist">{themes.map((theme) => <div key={theme} className="r"><span>{localeSafeText(theme, locale, tr(locale, "Custom theme", "自定义主题"))}</span><RemoveButton kind="theme" refId={theme} locale={locale} /></div>)}{themes.length === 0 && <div className="r monitor-empty">{tr(locale, "No followed themes.", "尚未关注交易主线。")}</div>}</div></div>
        </div>
      </section>

      <section className="blk"><div className="section-t">{tr(locale, "Create monitoring rule", "创建监控规则")}</div><MonitoringRuleForm assets={assetOptions} institutions={institutionOptions} themes={themes} locale={locale} /></section>

      <section className="blk monitor-object-grid">
        <div><div className="section-t">{tr(locale, "Active rules", "监控规则")} · {rules.length}</div><div className="rowlist">
          {rules.map((rule) => <div key={rule.id} className="r monitor-rule-row"><span><b>{localeSafeText(rule.name, locale, tr(locale, "Monitoring rule", "监控规则"))}</b><small>{describeRule(rule, locale)}</small></span><span className="monitor-actions"><form action={toggleRule}><input type="hidden" name="id" value={rule.id} /><button className={`chip ${rule.active ? "acc" : "gray"}`}>{rule.active ? tr(locale, "active", "启用") : tr(locale, "paused", "暂停")}</button></form><form action={deleteRule}><input type="hidden" name="id" value={rule.id} /><button className="iconbtn" title={tr(locale, "Delete", "删除")}>✕</button></form></span></div>)}
          {rules.length === 0 && <div className="r monitor-empty">{tr(locale, "No monitoring rules yet.", "尚未创建监控规则。")}</div>}
        </div></div>
        <div><div className="section-t">{tr(locale, "Recent triggers", "近期触发")} · {events.length}</div><div className="feed">
          {events.map((event) => <div key={event.id} className="fcard"><div className="top"><b>{localeSafeText(event.rule.name, locale, tr(locale, "Monitoring rule", "监控规则"))}</b><span>· {relTime(event.firedAt, locale)}</span></div><div className="monitor-event-copy">{alertMessage(event)}</div>{(event.targetId || event.assetTicker) && <Link href={event.targetId ? `/research/${event.targetId}` : `/asset/${event.assetTicker}`} className="minibtn">{tr(locale, "Open evidence", "查看依据")} →</Link>}</div>)}
          {events.length === 0 && <p className="mono monitor-empty">{tr(locale, "No triggers yet.", "尚未触发提醒。")}</p>}
        </div></div>
      </section>
    </main>
  );
}
