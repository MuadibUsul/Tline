import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { canonical } from "@/lib/seo";
import { publicationReadyWhere } from "@/lib/publication";
import { buildTradingThemes, type ThemeDirection } from "@/lib/tradingThemes";
import { assetName, formatDate, getLocale, institutionName, localizeChineseContent, tr, localePath } from "@/lib/i18n";
import { researchPath } from "@/lib/researchPath";
import { relTime } from "@/app/_components/ui";
import { assetPath } from "@/lib/assetPath";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    ...canonical("/watchlist", locale),
    title: tr(locale, "Market Themes", "交易主线"),
    description: tr(locale, "The asset narratives currently supported by institutional research, with market confirmation and source evidence.", "从机构研报中识别当前市场正在运转的资产逻辑，并提供行情确认与原始依据。"),
  };
}

const STATUS = {
  strengthening: ["Strengthening", "强化中"], active: ["Active", "运转中"],
  diverging: ["Diverging", "出现分歧"], cooling: ["Cooling", "降温中"],
} as const;

function directionLabel(direction: ThemeDirection, zh: boolean) {
  return zh
    ? ({ bullish: "偏多", bearish: "偏空", neutral: "中性", conditional: "方向分歧" } as const)[direction]
    : ({ bullish: "Bullish", bearish: "Bearish", neutral: "Neutral", conditional: "Mixed" } as const)[direction];
}

function displayAsset(name: string, ticker: string | null, locale: "en" | "zh-CN") {
  return assetName(name, locale, ticker, ticker || name);
}

export default async function TradingThemesPage() {
  const locale = await getLocale();
  const zh = locale === "zh-CN";
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 864e5);
  const marketSince = new Date(now.getTime() - 8 * 864e5);
  const catalystUntil = new Date(now.getTime() + 7 * 864e5);

  const [views, observations, catalysts] = await Promise.all([
    prisma.atomicView.findMany({
      where: { reviewStatus: "ok", article: publicationReadyWhere({ publishedAt: { gte: fourteenDaysAgo } }) },
      select: {
        id: true, articleId: true, topic: true, asset: true, assetTicker: true, direction: true,
        importance: true, viewEn: true, viewZh: true, rationaleEn: true, rationaleZh: true,
        conditionEn: true, conditionZh: true,
        article: { select: { slug: true, title: true, publishedAt: true, institutionId: true, institution: { select: { slug: true, name: true, rating: true, authorityScore: true } } } },
      },
    }),
    prisma.marketObservation.findMany({
      where: { observedAt: { gte: marketSince }, instrument: { enabled: true } },
      orderBy: { observedAt: "asc" },
      select: { close: true, instrument: { select: { symbol: true } } },
    }),
    prisma.macroRelease.findMany({
      where: { scheduledAt: { gte: now, lte: catalystUntil }, importance: { gte: 4 } },
      orderBy: { scheduledAt: "asc" }, take: 6,
      select: { id: true, titleEn: true, titleZh: true, countryCode: true, scheduledAt: true, importance: true },
    }),
  ]);

  const priceRanges = new Map<string, { first: number; last: number }>();
  for (const observation of observations) {
    const symbol = observation.instrument.symbol.toUpperCase();
    const close = Number(observation.close);
    const range = priceRanges.get(symbol);
    if (range) range.last = close;
    else priceRanges.set(symbol, { first: close, last: close });
  }
  const marketMoves = [...priceRanges].filter(([, range]) => range.first !== 0).map(([symbol, range]) => ({ symbol, changePct: (range.last / range.first - 1) * 100 }));
  const themes = buildTradingThemes(views, now, marketMoves);
  const lead = themes[0];
  const changed = themes.filter((theme) => theme.status !== "active").slice(0, 5);

  return (
    <main className="wrap themes-page">
      <header className="page-head themes-head">
        <div className="eyebrow">{tr(locale, "Live market narratives", "当前市场叙事")}</div>
        <h1>{tr(locale, "Market Themes", "交易主线")}</h1>
        <p className="sub">{tr(locale, "What institutions are pricing into assets now — ranked by breadth, importance and freshness, then checked against market direction.", "把机构最近在讨论的驱动因素、传导路径与资产方向连接起来，并用行情判断逻辑是否得到确认。")}</p>
        <div className="themes-method"><span>{tr(locale, "7-day signal window", "7天信号窗口")}</span><span>{tr(locale, "14-day comparison", "对比此前7天")}</span><span>{tr(locale, "No page-level AI generation", "页面不额外调用 AI")}</span><time>{tr(locale, "Updated", "更新于")} {formatDate(now, locale)}</time></div>
      </header>

      {lead ? <section className="theme-lead" aria-labelledby="lead-theme-title">
        <div className="theme-lead-copy">
          <div className="theme-kicker"><span className={`theme-state ${lead.status}`}>{zh ? STATUS[lead.status][1] : STATUS[lead.status][0]}</span><span>{tr(locale, "Leading theme", "最强主线")}</span></div>
          <h2 id="lead-theme-title">{zh ? lead.titleZh : lead.titleEn}</h2>
          <p>{zh ? localizeChineseContent(lead.lead.rationaleZh || lead.lead.viewZh) : lead.lead.rationaleEn || lead.lead.viewEn}</p>
          <div className="theme-chain" aria-label={tr(locale, "Transmission path", "传导路径")}><b>{zh ? lead.titleZh : lead.titleEn}</b><i>→</i>{lead.assets.slice(0, 3).map((asset) => <span key={asset.ticker || asset.name}>{displayAsset(asset.name, asset.ticker, locale)} <em className={asset.direction}>{directionLabel(asset.direction, zh)}</em></span>)}</div>
        </div>
        <div className="theme-lead-score"><strong>{lead.score}</strong><span>{tr(locale, "theme strength", "主线强度")}</span><small>{lead.institutionCount}{tr(locale, " institutions", "家机构")} · {lead.viewCount}{tr(locale, " signals", "条观点")}</small></div>
      </section> : <div className="theme-empty"><h2>{tr(locale, "No active theme yet", "暂未形成活跃主线")}</h2><p>{tr(locale, "A theme appears once reviewed institutional views enter the seven-day window.", "通过审核的机构观点进入最近7天窗口后，主线会自动形成。")}</p></div>}

      <div className="themes-layout">
        <section className="themes-ledger" aria-label={tr(locale, "Active market themes", "活跃交易主线")}>
          <div className="themes-section-head"><h2>{tr(locale, "Active themes", "正在运转")}</h2><span>{themes.length}</span></div>
          {themes.map((theme, index) => {
            const condition = zh ? theme.lead.conditionZh : theme.lead.conditionEn;
            const rationale = zh ? theme.lead.rationaleZh || theme.lead.viewZh : theme.lead.rationaleEn || theme.lead.viewEn;
            return <article className="theme-row" key={theme.key}>
              <div className="theme-rank">{String(index + 1).padStart(2, "0")}</div>
              <div className="theme-body">
                <div className="theme-row-head"><div><span className={`theme-state ${theme.status}`}>{zh ? STATUS[theme.status][1] : STATUS[theme.status][0]}</span><h3>{zh ? theme.titleZh : theme.titleEn}</h3></div><strong>{theme.score}</strong></div>
                <p>{zh ? localizeChineseContent(rationale) : rationale}</p>
                <div className="theme-assets">{theme.assets.map((asset) => <span key={asset.ticker || asset.name} className="theme-asset">{asset.ticker ? <Link href={localePath(locale, assetPath(asset.ticker))}>{displayAsset(asset.name, asset.ticker, locale)}</Link> : displayAsset(asset.name, null, locale)}<em className={asset.direction}>{directionLabel(asset.direction, zh)}</em>{asset.movePct !== null && <small className={asset.marketConfirmed ? "confirmed" : "unconfirmed"}>{asset.movePct > 0 ? "+" : ""}{asset.movePct.toFixed(1)}% · {asset.marketConfirmed ? tr(locale, "confirmed", "行情确认") : tr(locale, "not confirmed", "尚未确认")}</small>}</span>)}</div>
                <div className="theme-facts"><span>{theme.institutionCount}{tr(locale, " institutions", "家机构")}</span><span>{theme.viewCount}{tr(locale, " signals / 7d", "条观点 / 7天")}</span><span>{tr(locale, "Previous window", "此前7天")} {theme.previousViewCount}</span><span>{relTime(theme.latestAt, locale)}</span></div>
                {condition && <div className="theme-condition"><b>{tr(locale, "Invalidation / condition", "失效条件 / 前提")}</b><span>{zh ? localizeChineseContent(condition) : condition}</span></div>}
                <details className="theme-evidence"><summary>{tr(locale, "View source evidence", "查看来源依据")} · {theme.evidence.length}</summary><div>{theme.evidence.map((view) => <Link href={localePath(locale, researchPath(view.article))} key={view.id}><span>{institutionName(view.article.institution.name, locale)}</span><b>{zh ? localizeChineseContent(view.viewZh) : view.viewEn}</b></Link>)}</div></details>
              </div>
            </article>;
          })}
        </section>

        <aside className="themes-aside">
          <section><div className="themes-section-head"><h2>{tr(locale, "What changed", "今日变化")}</h2></div><div className="theme-change-list">{changed.map((theme) => <div key={theme.key}><span className={`theme-dot ${theme.status}`} /><p><b>{zh ? theme.titleZh : theme.titleEn}</b><small>{zh ? STATUS[theme.status][1] : STATUS[theme.status][0]} · {theme.viewCount}{tr(locale, " signals this week", "条本周观点")}</small></p></div>)}{changed.length === 0 && <p className="theme-muted">{tr(locale, "No material change in the current window.", "当前窗口暂无明显变化。")}</p>}</div></section>
          <section><div className="themes-section-head"><h2>{tr(locale, "Next catalysts", "接下来关注")}</h2><span>7D</span></div><div className="theme-catalysts">{catalysts.map((release) => <Link href={localePath(locale, `/macro/release/${release.id}`)} key={release.id}><time>{formatDate(release.scheduledAt, locale)}</time><b>{zh ? release.titleZh || release.titleEn : release.titleEn}</b><small>{release.countryCode} · {"●".repeat(Math.min(5, release.importance))}</small></Link>)}{catalysts.length === 0 && <p className="theme-muted">{tr(locale, "No high-impact release scheduled in the next seven days.", "未来7天暂无已排期的高影响数据。")}</p>}</div></section>
          <section className="theme-explainer"><div className="themes-section-head"><h2>{tr(locale, "How it is generated", "生成逻辑")}</h2></div><p>{tr(locale, "Reviewed institutional views are normalized into themes. Breadth, importance and freshness determine rank; price direction confirms but does not create a theme.", "将已审核机构观点归一为主题，按跨机构覆盖、重要度和新鲜度排序；行情只负责确认，不负责凭空生成主线。")}</p><Link href={localePath(locale, "/methodology")}>{tr(locale, "Methodology", "查看方法论")} →</Link></section>
        </aside>
      </div>
    </main>
  );
}
