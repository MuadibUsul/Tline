import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { getPublishedNewsBySlug, newsBody, newsColumnName, newsDateLabel, newsExcerpt, newsImageAlt, newsImageCaption, newsLocales, newsSources, newsTitle, splitNewsMarkdownBlocks, NEWS_KIND_LABEL, isNewsKind, type NewsImageRecord } from "@/lib/news";
import { renderNewsMarkdownBlocks } from "@/lib/newsMarkdown";
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
  const description = clamp(newsExcerpt(post, locale, 158) || title, 158);
  const locales = newsLocales(post);
  return {
    ...(locales.length ? canonical(`/news/${post.slug}`, locale, locales) : { alternates: { canonical: localizedUrl(`/news/${post.slug}`, locale) } }),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "article", title, description, url: localizedUrl(`/news/${post.slug}`, locale), locale, images: [{ url: ogImage("News", title, tr(locale, "From the newsroom", "来自新闻编辑部")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

function blockLabel(block: string, index: number): string {
  const first = block.split("\n")[0]
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?\[![^\]]+\]\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`~]/g, "")
    .trim();
  return (first || `${index + 1}`).slice(0, 80);
}

function NewsFigure({ image, locale }: { image: NewsImageRecord; locale: Locale }) {
  const caption = newsImageCaption(image, locale);
  return (
    <figure className="news-figure">
      {/* eslint-disable-next-line @next/next/no-img-element -- served from the newsroom's private image store */}
      <img
        src={`/api/news-images/${image.id}`}
        alt={newsImageAlt(image, locale)}
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        loading="lazy"
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
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
  const blocks = splitNewsMarkdownBlocks(body);
  const renderedBlocks = await renderNewsMarkdownBlocks(blocks, locale);
  const images = post.images ?? [];
  const imagesAt = (position: number) => images.filter((image) => image.position === position);
  const sources = newsSources(post);
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
        image: images[0] ? `${siteUrl()}/api/news-images/${images[0].id}` : new URL(ogImage("News", title, tr(locale, "From the newsroom", "来自新闻编辑部")), siteUrl()).toString(),
        author: { "@type": "Organization", name: tr(locale, "Tlines Newsroom", "Tlines 编辑部"), url: siteUrl() },
        publisher: { "@type": "Organization", name: "Tlines", url: siteUrl(), logo: { "@type": "ImageObject", url: `${siteUrl()}/icon.svg` } },
        ...(post.column ? { isPartOf: { "@type": "Periodical", name: newsColumnName(post.column, locale), url: localizedUrl(`/news/columns/${post.column.slug}`, locale) }, articleSection: newsColumnName(post.column, locale) } : {}),
        ...(post.sourceUrl ? { isBasedOn: sources.length > 1 ? sources : post.sourceUrl } : {}),
      }} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "News", "新鲜事"), path: "/news" }, { name: title, path: `/news/${post.slug}` }])} />
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")} style={{ margin: "16px 0 10px" }}>
        <Link href={localePath(locale, "/news")}>{tr(locale, "News", "新鲜事")}</Link>
      </nav>
      <header className="news-item-head">
        <div className="news-rail" style={{ marginBottom: 10 }}>
          {post.column ? (
            <Link className="news-column-tag" href={localePath(locale, `/news/columns/${post.column.slug}`)}>
              {newsColumnName(post.column, locale)}
            </Link>
          ) : null}
          <span className={`chip ${kind === "flash" ? "bear" : kind === "article" ? "acc" : "gray"}`}>
            {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
          </span>
          {publishedAt ? <time className="mono" dateTime={publishedAt.toISOString()} style={{ fontSize: 11.5, color: "var(--faint)" }}>{newsDateLabel(publishedAt, locale)}</time> : null}
          {post.pinned ? <span className="chip bull">{tr(locale, "Pinned", "置顶")}</span> : null}
        </div>
        <h1 className="art-title">{title}</h1>
        {sources.length > 0 ? (
          <p className="news-sources">
            <span>{tr(locale, "Sources", "来源")}</span>
            {sources.map((source) => {
              let host = source;
              try { host = new URL(source).hostname.replace(/^www\./, ""); } catch { /* keep the address */ }
              return <a key={source} className="ed-source" href={source} target="_blank" rel="noopener noreferrer">{host} <span aria-hidden="true">↗</span></a>;
            })}
          </p>
        ) : null}
      </header>
      <article className="prose news-item-body">
        {imagesAt(0).map((image) => <NewsFigure key={image.id} image={image} locale={locale} />)}
        {renderedBlocks.length ? renderedBlocks.map((block, index) => (
          <div
            className="news-body-block"
            key={index}
            data-track-section={`news-block-${index + 1}`}
            data-track-title={blockLabel(blocks[index] ?? "", index)}
          >
            {block}
            {imagesAt(index + 1).map((image) => <NewsFigure key={image.id} image={image} locale={locale} />)}
          </div>
        )) : <p className="sub">{tr(locale, "This item has no further text.", "本条没有更多正文。")}</p>}
        {images.filter((image) => image.position > blocks.length).map((image) => <NewsFigure key={image.id} image={image} locale={locale} />)}
      </article>
      <p className="sub" style={{ marginTop: 26 }}>
        {post.column ? (
          <>
            <Link href={localePath(locale, `/news/columns/${post.column.slug}`)}>
              {tr(locale, "More from", "更多")}{newsColumnName(post.column, locale)} →
            </Link>
            {" · "}
          </>
        ) : null}
        <Link href={localePath(locale, "/news")}>{tr(locale, "All news", "全部新鲜事")} →</Link>
      </p>
    </main>
  );
}
