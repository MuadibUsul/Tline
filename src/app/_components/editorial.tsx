import Link from "next/link";
import { formatDate, institutionName, localePath, tr, type Locale } from "@/lib/i18n";

/**
 * The editorial component set (PRD §6.3). Server components throughout — they only shape
 * markup around data the page has already loaded through the publication gate; none of
 * them query, and none of them can introduce a page the gate would not serve.
 */

export function Byline({
  locale,
  institution,
  institutionSlug,
  publishedAt,
  updatedAt,
}: {
  locale: Locale;
  institution: string;
  institutionSlug?: string;
  publishedAt: Date | string;
  updatedAt?: Date | string | null;
}) {
  const name = institutionName(institution, locale);
  return (
    <div className="ed-byline">
      {institutionSlug ? <Link href={localePath(locale, `/institution/${institutionSlug}`)}><b>{name}</b></Link> : <b>{name}</b>}
      <span aria-hidden="true">·</span>
      <time dateTime={new Date(publishedAt).toISOString()}>{formatDate(publishedAt, locale)}</time>
      {updatedAt ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{tr(locale, "updated", "更新于")} {formatDate(updatedAt, locale)}</span>
        </>
      ) : null}
    </div>
  );
}

/** The external source link, labelled with its domain so the reader knows where it goes. */
export function SourceBadge({ href, locale }: { href: string; locale: Locale }) {
  let domain = href;
  try {
    domain = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    /* keep the raw string */
  }
  return (
    <a className="ed-source" href={href} target="_blank" rel="noopener noreferrer">
      {tr(locale, "Read the original", "阅读官网原文")} · {domain} <span aria-hidden="true">↗</span>
    </a>
  );
}

/** One-sentence conclusion plus the key figures, straight from the stored analysis. */
export function KeyTakeaways({
  locale,
  summary,
  numbers,
}: {
  locale: Locale;
  summary: string | null | undefined;
  numbers: Array<{ label?: string; value?: string }>;
}) {
  if (!summary && numbers.length === 0) return null;
  return (
    <section className="ed-kt" aria-label={tr(locale, "Key takeaways", "核心观点")}>
      <h2>{tr(locale, "Key takeaways", "核心观点")}</h2>
      {summary ? <p style={{ margin: "0 0 10px", lineHeight: 1.75 }}>{summary}</p> : null}
      {numbers.length > 0 && (
        <ul>
          {numbers.slice(0, 5).map((item, index) => (
            <li key={index}>
              {item.label ? <>{item.label}：</> : null}
              <b>{item.value ?? ""}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Quote({ text, cite }: { text: string; cite?: string }) {
  return (
    <blockquote className="ed-quote">
      {text}
      {cite ? <footer>{cite}</footer> : null}
    </blockquote>
  );
}

/** The evidence rail entry: a claim, its source sentence, and where it came from. */
export function EvidenceEntry({
  view,
  sourceUrl,
  publishedAt,
  locale,
}: {
  view: { id: string; view: string; sourceQuote?: string | null; importance: number };
  sourceUrl: string;
  publishedAt: Date | string;
  locale: Locale;
}) {
  return (
    <article className="ed-ev">
      <p>{view.view}</p>
      <small>
        {formatDate(publishedAt, locale)}
        {view.sourceQuote ? ` · ${tr(locale, "source quote", "原文引用")}` : ` · ${tr(locale, "derived view", "结构化观点")}`}
      </small>
      {view.sourceQuote ? <blockquote>{view.sourceQuote}</blockquote> : null}
      <small style={{ marginTop: 6 }}>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Locate in source", "前往原文定位")} ↗</a>
      </small>
    </article>
  );
}

/** A quiet notice for a page that carries a published correction. */
export function CorrectionBanner({ locale, note }: { locale: Locale; note: string }) {
  return (
    <aside className="ed-correction" role="note">
      <b>{tr(locale, "Correction", "更正")}</b>
      <span>
        {note}{" "}
        <Link href={localePath(locale, "/corrections")} style={{ textDecoration: "underline" }}>
          {tr(locale, "Corrections policy", "更正机制")}
        </Link>
      </span>
    </aside>
  );
}
