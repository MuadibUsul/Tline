import Link from "next/link";
import { directionLabel } from "@/lib/assets";
import { articleTimestamp, assetName, institutionName, localizeChineseContent, relativeTime, tr, type Locale, localePath } from "@/lib/i18n";

export const relTime = (d: Date, locale: Locale = "en") => relativeTime(d, locale);

export function DirChip({ direction, locale = "en", showLabel = true }: { direction: number; locale?: Locale; showLabel?: boolean }) {
  const d = directionLabel(direction);
  const arrow = d.tone === "bull" ? "▲" : d.tone === "bear" ? "▼" : "◆";
  const label = d.tone === "bull" ? tr(locale, d.label, "看多") : d.tone === "bear" ? tr(locale, d.label, "看空") : tr(locale, d.label, "中性");
  return (
    <span className={`chip ${d.tone}`}>
      {arrow}{showLabel ? ` ${label}` : ""}
    </span>
  );
}

export function Delta({ v, suffix = "" }: { v: number | null; suffix?: string }) {
  if (v === null) return <b className="mono">—</b>;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return <b className={`mono ${cls}`}>{sign}{Math.abs(v)}{suffix}</b>;
}

type FeedArticle = {
  id: string;
  title: string;
  rawText?: string | null;
  publishedAt: Date;
  createdAt: Date;
  sourceUrl: string;
  institution: { name: string; slug: string };
  analysis: { summary: string; summaryZh?: string | null } | null;
  translations?: { title: string; text?: string }[];
  articleAssets: { direction: number; target: number | null; previousTarget: number | null; asset: { ticker: string; name: string } }[];
};

export function FeedCard({ a, locale = "en" }: { a: FeedArticle; locale?: Locale }) {
  const primary = a.articleAssets[0];
  return (
    <article className="fcard">
      <div className="top">
        <b>{institutionName(a.institution.name, locale)}</b> · <span>{relTime(articleTimestamp(a.publishedAt, a.createdAt), locale)}</span>
      </div>
      <h3 className="ttl"><Link href={localePath(locale, `/research/${a.id}`)}>{locale === "zh-CN" && a.translations?.[0] ? localizeChineseContent(a.translations[0].title) : a.title}</Link></h3>
      <div className="tags">
        {a.articleAssets.slice(0, 4).map((aa) => {
          const direction = directionLabel(aa.direction);
          const arrow = direction.tone === "bull" ? "▲" : direction.tone === "bear" ? "▼" : "◆";
          return <Link key={aa.asset.ticker} href={localePath(locale, `/asset/${aa.asset.ticker}`)} className={`chip ${direction.tone}`}>{aa.asset.ticker} {arrow}</Link>;
        })}
      </div>
      {(primary?.target || primary?.previousTarget) && (
        <div className="kv">
          {primary.previousTarget && primary.target && (
            <div><span>{tr(locale, "Target", "目标价")}</span><b>${primary.previousTarget.toLocaleString()} → ${primary.target.toLocaleString()}</b></div>
          )}
          {primary.target && !primary.previousTarget && (
            <div><span>{tr(locale, "Target", "目标价")}</span><b>${primary.target.toLocaleString()}</b></div>
          )}
        </div>
      )}
      <div className="act">
        <Link href={localePath(locale, `/research/${a.id}`)} className="minibtn p">{tr(locale, "View analysis", "查看分析")}</Link>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Official source ↗", "官网原文 ↗")}</a>
      </div>
    </article>
  );
}

function shortPreview(text: string | null | undefined) {
  const clean = text?.replace(/\s+/g, " ").trim() ?? "";
  if (clean.length <= 260) return clean;
  const cut = clean.slice(0, 260);
  return `${cut.replace(/\s+\S*$/, "") || cut}…`;
}

export function ResearchCard({ a, locale = "en" }: { a: FeedArticle; locale?: Locale }) {
  const translation = a.translations?.[0];
  const title = locale === "zh-CN" && translation ? localizeChineseContent(translation.title) : a.title;
  const preview = shortPreview(locale === "zh-CN"
    ? translation?.text ?? a.analysis?.summaryZh ?? a.rawText
    : a.analysis?.summary ?? a.rawText);
  const localizedPreview = locale === "zh-CN" && preview ? localizeChineseContent(preview) : preview;

  return (
    <article className="research-card">
      <div className="research-card-meta">
        <Link href={localePath(locale, `/institution/${a.institution.slug}`)}>{institutionName(a.institution.name, locale)}</Link>
        <span>·</span>
        <span>{relTime(articleTimestamp(a.publishedAt, a.createdAt), locale)}</span>
      </div>
      <h2><Link href={localePath(locale, `/research/${a.id}`)}>{title}</Link></h2>
      {localizedPreview && <p>{localizedPreview}</p>}
      <div className="research-card-assets">
        {a.articleAssets.slice(0, 4).map((articleAsset) => {
          const direction = directionLabel(articleAsset.direction);
          const arrow = direction.tone === "bull" ? "▲" : direction.tone === "bear" ? "▼" : "◆";
          const label = direction.tone === "bull" ? tr(locale, "Bullish", "看多") : direction.tone === "bear" ? tr(locale, "Bearish", "看空") : tr(locale, "Neutral", "中性");
          return (
            <Link
              key={articleAsset.asset.ticker}
              href={localePath(locale, `/asset/${articleAsset.asset.ticker}`)}
              className={`chip ${direction.tone}`}
              title={`${assetName(articleAsset.asset.name, locale, articleAsset.asset.ticker)} · ${label}`}
              aria-label={`${assetName(articleAsset.asset.name, locale, articleAsset.asset.ticker)} · ${label}`}
            >
              {articleAsset.asset.ticker} <span aria-hidden="true">{arrow}</span>
            </Link>
          );
        })}
        {a.articleAssets.length > 4 && <span className="chip gray">+{a.articleAssets.length - 4}</span>}
      </div>
      <div className="research-card-actions">
        <Link href={localePath(locale, `/research/${a.id}`)} className="minibtn p">{tr(locale, "Read", "阅读")}</Link>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Source ↗", "官网 ↗")}</a>
      </div>
    </article>
  );
}
