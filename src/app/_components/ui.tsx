import Link from "next/link";
import { directionLabel } from "@/lib/assets";
import { relativeTime, tr, type Locale } from "@/lib/i18n";

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
  publishedAt: Date;
  sourceUrl: string;
  institution: { name: string; slug: string };
  analysis: { summary: string } | null;
  translations?: { title: string }[];
  articleAssets: { direction: number; target: number | null; previousTarget: number | null; asset: { ticker: string; name: string } }[];
};

export function FeedCard({ a, locale = "en" }: { a: FeedArticle; locale?: Locale }) {
  const primary = a.articleAssets[0];
  const dir = primary?.direction ?? 0;
  return (
    <article className="fcard">
      <div className="top">
        <b>{a.institution.name}</b> · <span>{relTime(a.publishedAt, locale)}</span>
        <span style={{ marginLeft: "auto" }}><DirChip direction={dir} locale={locale} /></span>
      </div>
      <h3 className="ttl"><Link href={`/research/${a.id}`}>{locale === "zh-CN" ? a.translations?.[0]?.title ?? a.title : a.title}</Link></h3>
      <div className="tags">
        {a.articleAssets.slice(0, 4).map((aa) => (
          <Link key={aa.asset.ticker} href={`/asset/${aa.asset.ticker}`} className="chip gray">{aa.asset.ticker}</Link>
        ))}
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
        <Link href={`/research/${a.id}`} className="minibtn p">{tr(locale, "View analysis", "查看分析")}</Link>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Official source ↗", "官网原文 ↗")}</a>
      </div>
    </article>
  );
}
