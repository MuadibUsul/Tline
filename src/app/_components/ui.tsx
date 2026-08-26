import Link from "next/link";
import { directionLabel } from "@/lib/assets";

export function relTime(d: Date): string {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function DirChip({ direction, showLabel = true }: { direction: number; showLabel?: boolean }) {
  const d = directionLabel(direction);
  const arrow = d.tone === "bull" ? "▲" : d.tone === "bear" ? "▼" : "◆";
  return (
    <span className={`chip ${d.tone}`}>
      {arrow}{showLabel ? ` ${d.label}` : ""}
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
  articleAssets: { direction: number; target: number | null; previousTarget: number | null; asset: { ticker: string; name: string } }[];
};

export function FeedCard({ a }: { a: FeedArticle }) {
  const primary = a.articleAssets[0];
  const dir = primary?.direction ?? 0;
  return (
    <article className="fcard">
      <div className="top">
        <b>{a.institution.name}</b> · <span>{relTime(a.publishedAt)}</span>
        <span style={{ marginLeft: "auto" }}><DirChip direction={dir} /></span>
      </div>
      <h3 className="ttl"><Link href={`/research/${a.id}`}>{a.title}</Link></h3>
      <div className="tags">
        {a.articleAssets.slice(0, 4).map((aa) => (
          <Link key={aa.asset.ticker} href={`/asset/${aa.asset.ticker}`} className="chip gray">{aa.asset.ticker}</Link>
        ))}
      </div>
      {(primary?.target || primary?.previousTarget) && (
        <div className="kv">
          {primary.previousTarget && primary.target && (
            <div><span>Target</span><b>${primary.previousTarget.toLocaleString()} → ${primary.target.toLocaleString()}</b></div>
          )}
          {primary.target && !primary.previousTarget && (
            <div><span>Target</span><b>${primary.target.toLocaleString()}</b></div>
          )}
        </div>
      )}
      <div className="act">
        <Link href={`/research/${a.id}`} className="minibtn p">查看分析 · Analysis</Link>
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="minibtn">官网原文 ↗</a>
      </div>
    </article>
  );
}
