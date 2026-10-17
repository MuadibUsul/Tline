import Link from "next/link";
import { localePath, tr, type Locale } from "@/lib/i18n";
import { NEWS_KIND_LABEL, isNewsKind, newsColumnName, newsExcerpt, newsTitle, type NewsRecord } from "@/lib/news";

/** Beijing time for the desk's clock, the same source the front-page rail uses. */
export function newsClock(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(date);
}

/**
 * One row of the newsroom stream, shared by /news and a column page so the two cannot drift.
 * The whole row is not a link: the headline and the column chip are, and the rail carries
 * time, kind and pinned state.
 */
export default function NewsRow({ post, locale, showColumn = false }: { post: NewsRecord; locale: Locale; showColumn?: boolean }) {
  const title = newsTitle(post, locale) ?? "";
  const kind = isNewsKind(post.kind) ? post.kind : "brief";
  const excerpt = newsExcerpt(post, locale);
  const cover = post.images?.[0] ?? null;

  return (
    <article className={`news-row ${kind}${cover ? " has-image" : ""}`}>
      <div className="news-rail">
        <time dateTime={post.publishedAt?.toISOString()}>{post.publishedAt ? newsClock(post.publishedAt, locale) : ""}</time>
        <span className={`chip ${kind === "flash" ? "bear" : kind === "article" ? "acc" : "gray"}`}>
          {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
        </span>
        {post.pinned ? <span className="chip bull">{tr(locale, "Pinned", "置顶")}</span> : null}
      </div>
      <div className="news-copy">
        <h2>
          <Link href={localePath(locale, `/news/${post.slug}`)}>{title}</Link>
        </h2>
        {kind !== "flash" && excerpt ? <p className="news-excerpt">{excerpt}</p> : null}
        <p className="news-source">
          {showColumn && post.column ? (
            <Link className="news-column-tag" href={localePath(locale, `/news/columns/${post.column.slug}`)}>
              {newsColumnName(post.column, locale)}
            </Link>
          ) : null}
          {post.sourceUrl ? (
            <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Source", "来源")} ↗</a>
          ) : null}
        </p>
      </div>
      {cover ? (
        <Link className="news-thumb" href={localePath(locale, `/news/${post.slug}`)} tabIndex={-1} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- stored in the news image table */}
          <img src={`/api/news-images/${cover.id}?variant=thumb`} alt={cover.alt ?? cover.caption ?? ""} loading="lazy" />
        </Link>
      ) : null}
    </article>
  );
}
