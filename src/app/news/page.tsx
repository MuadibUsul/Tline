import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { listPublishedNews, newsTitle, newsDayKey, newsDateLabel, NEWS_KIND_LABEL, isNewsKind } from "@/lib/news";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, localizedUrl, ogImage } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * 新鲜事 — the newsroom stream: what the desk is publishing, newest first, one row per
 * item regardless of length. A flash is the sentence itself; a brief adds a paragraph; an
 * article gets the fuller card. Each row links to its own permalink.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = tr(locale, "News", "新鲜事");
  const description = clamp(tr(
    locale,
    "The Tlines newsroom: short briefs, flashes and articles on the markets and the research behind them.",
    "Tlines 新闻编辑部：关于市场与机构研究的快讯、短讯与文章。",
  ), 158);
  return {
    ...canonical("/news", locale),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl("/news", locale), locale, images: [{ url: ogImage("News", title, tr(locale, "Briefs, flashes and articles", "快讯、短讯与文章")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Beijing time for the minutes on a flash — the desk's operating clock, like the calendar. */
function clockTime(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export default async function NewsIndex() {
  const locale: Locale = await getLocale();
  const posts = await listPublishedNews(locale, 60);

  // Group by the day the reader sees, so a busy morning reads as one block, not sixty rows.
  const groups = new Map<string, { label: string; items: typeof posts }>();
  for (const post of posts) {
    const at = post.publishedAt ?? new Date();
    const key = newsDayKey(at);
    const group = groups.get(key) ?? { label: newsDateLabel(at, locale), items: [] as typeof posts };
    group.items.push(post);
    groups.set(key, group);
  }

  return (
    <main className="wrap news-page">
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "News", "新鲜事"), path: "/news" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Newsroom", "新闻编辑部")}</div>
        <h1>{tr(locale, "News", "新鲜事")}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale, "Briefs, flashes and articles from the Tlines desk — written and published by the newsroom, each with its own permalink.", "来自 Tlines 编辑部的快讯、短讯与文章——由新闻编辑部撰写并发布，每条都有独立链接。")}
        </p>
      </div>

      {posts.length === 0 && <div className="empty-state">{tr(locale, "Nothing has been published yet.", "暂无已发布内容。")}</div>}

      {[...groups.entries()].map(([key, group]) => (
        <section className="blk news-day" key={key} aria-label={group.label}>
          <div className="section-t"><span>{group.label}</span></div>
          <div className="news-stream">
            {group.items.map((post) => {
              const title = newsTitle(post, locale) ?? "";
              const kind = isNewsKind(post.kind) ? post.kind : "brief";
              const body = (locale === "zh-CN" ? post.bodyZh : post.bodyEn) ?? "";
              const excerpt = body.replace(/\s+/g, " ").trim();
              return (
                <article className={`news-row ${kind}`} key={post.id}>
                  <div className="news-rail">
                    <time dateTime={post.publishedAt?.toISOString()}>{post.publishedAt ? clockTime(post.publishedAt, locale) : ""}</time>
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
                    {post.sourceUrl ? <p className="news-source"><a href={post.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Source", "来源")} ↗</a></p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
