import type { Metadata } from "next";
import Link from "next/link";
import { assetName, getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { assetPath } from "@/lib/assetPath";
import { type ThemeDirection, type ThemeStatus } from "@/lib/tradingThemes";
import { loadPublicThemes } from "@/lib/marketThemesPublic";
import { macroDateTime } from "@/lib/macro/presentation";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, localizedUrl, marketThemesSeoTitle, ogImage } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * The public half of the Market Themes desk.
 *
 * What is published here is the part the snapshot already stores as its compact summary: how
 * many themes are live, what they are called, which way they lean, how many institutions and
 * views stand behind each, which assets they touch and whether the market has moved with them.
 * The reasoning, the evidence links and the invalidation conditions stay on the gated desk —
 * they are the product, and a search engine is not a customer.
 */
const STATUS: Record<ThemeStatus, [string, string]> = {
  strengthening: ["Strengthening", "强化中"], active: ["Active", "运转中"],
  diverging: ["Diverging", "出现分歧"], cooling: ["Cooling", "降温中"],
};
const MARKET_STATUS: Record<string, [string, string]> = {
  aligned: ["Market aligned", "行情同向"], opposed: ["Market opposed", "行情反向"],
  mixed: ["Market mixed", "行情混合"], insufficient: ["Market data unavailable", "行情数据不足"],
};

const directionLabel = (direction: ThemeDirection, locale: Locale) => (locale === "zh-CN"
  ? ({ bullish: "偏多", bearish: "偏空", neutral: "中性", conditional: "方向分歧" } as Record<string, string>)[direction]
  : ({ bullish: "Bullish", bearish: "Bearish", neutral: "Neutral", conditional: "Mixed" } as Record<string, string>)[direction]) ?? direction;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = marketThemesSeoTitle(locale);
  const description = tr(
    locale,
    "The asset narratives institutions are writing about right now: how many houses support each, which assets they touch, and whether the market has moved with them.",
    "机构当前正在讨论的资产逻辑：每个逻辑有多少家机构支持、涉及哪些资产，以及行情是否同向。",
  );
  const themes = await loadPublicThemes();
  return {
    ...canonical("/market-themes", locale),
    // With no live theme the page would be a promise, not a report.
    ...(themes.length ? {} : { robots: { index: false, follow: true } }),
    title: { absolute: title },
    description: clamp(description, 158),
    openGraph: { type: "website", title, description, url: localizedUrl("/market-themes", locale), locale, images: [{ url: ogImage("Market themes", title, tr(locale, "Narratives backed by institutional research", "由机构研报支撑的市场逻辑")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MarketThemesPage() {
  const locale = await getLocale();
  const zh = locale === "zh-CN";
  const themes = await loadPublicThemes();
  const updatedAt = themes[0]?.latestAt ?? new Date();

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/market-themes", marketThemesSeoTitle(locale), tr(locale, "Asset narratives currently supported by institutional research.", "当前由机构研报支撑的资产逻辑。"), tr(locale, "Market themes", "交易主线"))} />
      {/* No ItemList here on purpose: a theme has no address of its own, and an ItemList whose
          every item points at this same page describes nothing. */}
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Market Themes", "交易主线"), path: "/market-themes" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Live market narratives", "当前市场叙事")}</div>
        <h1>{tr(locale, "Market Themes", "交易主线")}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            "A theme is a narrative that several institutions are writing about at once, in the same direction, on assets whose prices have moved with it. What follows is the current list with the breadth of support behind each one; the reasoning, the evidence links and the conditions that would invalidate a theme are on the desk.",
            "一条主线，是指多家机构在同一时间、朝同一方向讨论、且相关资产价格同步变动的叙事。以下是当前的主线清单与各自的支撑广度；具体逻辑、证据链接与失效条件在交易主线台内。")}
        </p>
        {themes.length > 0 && (
          <p className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
            {tr(locale, "Updated ", "更新于 ")}
            <time dateTime={updatedAt.toISOString()}>{macroDateTime(updatedAt, locale, zh ? "Asia/Shanghai" : "UTC")}</time>
            {" · "}
            <Link href={localePath(locale, "/methodology")}>{tr(locale, "How a theme is formed", "主线如何形成")}</Link>
          </p>
        )}
      </div>

      {themes.length === 0 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "No active theme at this moment", "当前暂无活跃主线")}</h2>
          <p className="sub" style={{ color: "var(--muted)", maxWidth: "72ch" }}>
            {tr(locale, "A theme appears once reviewed institutional views enter the seven-day window and the market confirms the direction. The rules are published in the methodology.", "当通过审核的机构观点进入最近 7 天窗口、且行情确认方向后，主线会自动形成。判定规则见方法论。")}
          </p>
        </section>
      )}

      {themes.map((theme) => (
        <section className="blk" key={theme.key}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{zh ? theme.titleZh : theme.titleEn}</h2>
            <span className={`chip ${theme.direction === "bullish" ? "bull" : theme.direction === "bearish" ? "bear" : "neu"}`}>{directionLabel(theme.direction, locale)}</span>
            <span className="chip gray">{zh ? STATUS[theme.status][1] : STATUS[theme.status][0]}</span>
            <span className="chip gray">{zh ? MARKET_STATUS[theme.marketStatus][1] : MARKET_STATUS[theme.marketStatus][0]}</span>
          </div>
          <p className="mono" style={{ fontSize: 11, color: "var(--faint)", marginBottom: 8 }}>
            {theme.institutionCount}{tr(locale, " institutions", "家机构")} · {theme.viewCount}{tr(locale, " views", "条观点")} · {tr(locale, "strength", "强度")} {theme.score} · {tr(locale, "market confirmation", "行情确认度")} {theme.marketConfirmation === null ? "—" : `${Math.round(theme.marketConfirmation * 100)}%`}
          </p>
          <div className="tag-row">
            {theme.assets.slice(0, 6).map((asset) => (
              <Link key={asset.ticker ?? asset.name} className="chip acc" href={localePath(locale, asset.ticker ? assetPath(asset.ticker) : "/markets")}>
                {assetName(asset.name, locale, asset.ticker, asset.ticker ?? asset.name)} · {directionLabel(asset.direction as ThemeDirection, locale)} · {asset.bullish}↑ {asset.bearish}↓
                {asset.movePct === null ? "" : ` · ${asset.movePct > 0 ? "+" : ""}${asset.movePct.toFixed(1)}%`}
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="sub" style={{ color: "var(--muted)", marginTop: 8 }}>
        <Link href={localePath(locale, "/signin")}>{tr(locale, "Sign in for the full evidence chain", "登录查看完整证据链")}</Link>
        {" · "}
        <Link href={localePath(locale, "/markets")}>{tr(locale, "Browse by asset", "按资产浏览")}</Link>
        {" · "}
        <Link href={localePath(locale, "/topics")}>{tr(locale, "Browse by topic", "按主题浏览")}</Link>
      </p>
    </main>
  );
}
