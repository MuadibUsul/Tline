import type { Metadata } from "next";
import { getLocale, tr, type Locale } from "@/lib/i18n";
import { listPublishedColumns, listPublishedNews, newsDayKey, newsDateLabel } from "@/lib/news";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, localizedUrl, ogImage } from "@/lib/seo";
import NewsRow from "./NewsRow";
import NewsColumns from "./NewsColumns";

export const dynamic = "force-dynamic";

/**
 * 新鲜事 — the newsroom stream: what the desk is publishing, newest first, one row per
 * item regardless of length. A flash is the sentence itself; a brief adds a paragraph; an
 * article gets the fuller card. Each row links to its own permalink.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const posts = await listPublishedNews(locale, 1);
  const title = tr(locale, "News", "新鲜事");
  const description = clamp(tr(
    locale,
    "The Tlines newsroom: short briefs, flashes and articles on the markets and the research behind them.",
    "Tlines 新闻编辑部：关于市场与机构研究的快讯、短讯与文章。",
  ), 158);
  return {
    ...canonical("/news", locale),
    // An empty stream is a shell, not a page; English has no newsroom edition yet.
    ...(posts.length ? {} : { robots: { index: false, follow: true } }),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl("/news", locale), locale, images: [{ url: ogImage("News", title, tr(locale, "Briefs, flashes and articles", "快讯、短讯与文章")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function NewsIndex() {
  const locale: Locale = await getLocale();
  const [posts, columns] = await Promise.all([listPublishedNews(locale, 60), listPublishedColumns(locale)]);

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
      {/* The stream opens on its first item: the page title and standfirst that used to sit
          here repeated what the navigation already says. The accessible heading remains. */}
      <h1 className="sr-only">{tr(locale, "News", "新鲜事")}</h1>

      <div className="news-layout">
        <div className="news-main">
          {posts.length === 0 && <div className="empty-state">{tr(locale, "Nothing has been published yet.", "暂无已发布内容。")}</div>}

          {[...groups.entries()].map(([key, group]) => (
            <section className="blk news-day" key={key} aria-label={group.label}>
              <div className="section-t"><span>{group.label}</span></div>
              <div className="news-stream">
                {group.items.map((post) => <NewsRow post={post} locale={locale} showColumn key={post.id} />)}
              </div>
            </section>
          ))}
        </div>
        {columns.length > 0 && <NewsColumns columns={columns} locale={locale} />}
      </div>
    </main>
  );
}
