import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { getPublishedNewsBySlug, newsBody, newsDateLabel, newsLocales, newsTitle, splitNewsParagraphs, NEWS_KIND_LABEL, isNewsKind } from "@/lib/news";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, localizedUrl, ogImage } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** The permalink for one news item. Drafts do not exist at a public address. */
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const post = await getPublishedNewsBySlug(slug);
  if (!post) return { title: tr(locale, "Not found", "未找到") };
  const title = newsTitle(post, locale) ?? newsTitle(post, "en") ?? "";
  const body = newsBody(post, locale) ?? "";
  const description = clamp(body.replace(/\s+/g, " ").trim() || title, 158);
  const locales = newsLocales(post);
  return {
    ...(locales.length ? canonical(`/news/${post.slug}`, locale, locales) : { alternates: { canonical: localizedUrl(`/news/${post.slug}`, locale) } }),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "article", title, description, url: localizedUrl(`/news/${post.slug}`, locale), locale, images: [{ url: ogImage("News", title, tr(locale, "From the newsroom", "来自新闻编辑部")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function NewsItemPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const locale: Locale = await getLocale();
  const post = await getPublishedNewsBySlug(slug);
  if (!post) notFound();

  // A language exists only where a title does; the other language is one hop away rather
  // than a page that renders empty text.
  const title = newsTitle(post, locale);
  if (!title) {
    const fallback = newsLocales(post)[0];
    if (fallback) permanentRedirect(localePath(fallback, `/news/${post.slug}`));
    notFound();
  }
  const kind = isNewsKind(post.kind) ? post.kind : "brief";
  const body = newsBody(post, locale);
  const paragraphs = splitNewsParagraphs(body);
  const publishedAt = post.publishedAt;

  return (
    <main className="wrap news-item">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: title,
        datePublished: publishedAt?.toISOString(),
        dateModified: post.updatedAt.toISOString(),
        url: localizedUrl(`/news/${post.slug}`, locale),
        mainEntityOfPage: localizedUrl(`/news/${post.slug}`, locale),
        inLanguage: locale,
        publisher: { "@type": "Organization", name: "Tlines", url: siteUrl() },
        ...(post.sourceUrl ? { isBasedOn: post.sourceUrl } : {}),
      }} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "News", "新鲜事"), path: "/news" }, { name: title, path: `/news/${post.slug}` }])} />
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")} style={{ margin: "16px 0 10px" }}>
        <Link href={localePath(locale, "/news")}>{tr(locale, "News", "新鲜事")}</Link>
      </nav>
      <header className="news-item-head">
        <div className="news-rail" style={{ marginBottom: 10 }}>
          <span className={`chip ${kind === "flash" ? "bear" : kind === "article" ? "acc" : "gray"}`}>
            {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
          </span>
          {publishedAt ? <time className="mono" dateTime={publishedAt.toISOString()} style={{ fontSize: 11.5, color: "var(--faint)" }}>{newsDateLabel(publishedAt, locale)}</time> : null}
          {post.pinned ? <span className="chip bull">{tr(locale, "Pinned", "置顶")}</span> : null}
        </div>
        <h1 className="art-title">{title}</h1>
        {post.sourceUrl ? (
          <p style={{ margin: "12px 0 0" }}>
            <a className="ed-source" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">
              {tr(locale, "Read the source", "阅读来源")} · {(() => { try { return new URL(post.sourceUrl).hostname.replace(/^www\./, ""); } catch { return post.sourceUrl; } })()} <span aria-hidden="true">↗</span>
            </a>
          </p>
        ) : null}
      </header>
      <article className="prose news-item-body">
        {paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="sub">{tr(locale, "This item has no further text.", "本条没有更多正文。")}</p>}
      </article>
      <p className="sub" style={{ marginTop: 26 }}>
        <Link href={localePath(locale, "/news")}>{tr(locale, "All news", "全部新鲜事")} →</Link>
      </p>
    </main>
  );
}
