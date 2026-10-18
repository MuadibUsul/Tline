import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { getPublishedColumnBySlug, newsCadenceLabel, newsColumnName, newsDateLabel } from "@/lib/news";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, localizedUrl, ogImage } from "@/lib/seo";
import NewsRow from "../../NewsRow";

export const dynamic = "force-dynamic";

/** A recurring desk page: every published edition of one column, newest first. */
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([props.params, getLocale()]);
  const otherLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  const [column, other] = await Promise.all([
    getPublishedColumnBySlug(slug, locale),
    getPublishedColumnBySlug(slug, otherLocale),
  ]);
  if (!column) return { title: tr(locale, "Not found", "未找到") };
  const availableLocales: Locale[] = [locale, ...(other ? [otherLocale] : [])];
  const name = newsColumnName(column, locale);
  const description = clamp(
    (locale === "zh-CN" ? column.descriptionZh : column.descriptionEn) || tr(
      locale,
      `${name}: ${column.posts.length} editions, newest first.`,
      `${name}:${column.posts.length} 期内容，按时间倒序。`,
    ),
    158,
  );
  return {
    ...canonical(`/news/columns/${column.slug}`, locale, availableLocales),
    title: { absolute: `${name} · Tlines` },
    description,
    openGraph: { type: "website", title: name, description, url: localizedUrl(`/news/columns/${column.slug}`, locale), locale, images: [{ url: ogImage("Column", name, tr(locale, "An ongoing Tlines desk", "Tlines 长期栏目")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: name, description },
  };
}

export default async function NewsColumnPage(props: { params: Promise<{ slug: string }> }) {
  const [{ slug }, locale] = await Promise.all([props.params, getLocale()]);
  const otherLocale: Locale = locale === "zh-CN" ? "en" : "zh-CN";
  const [column, other] = await Promise.all([
    getPublishedColumnBySlug(slug, locale),
    getPublishedColumnBySlug(slug, otherLocale),
  ]);
  // A column with no edition in this language is not an empty page: send the reader to the
  // language it does publish in, rather than a 404 next to a working alternate.
  if (!column && other) permanentRedirect(localePath(otherLocale, `/news/columns/${slug}`));
  if (!column) notFound();
  const name = newsColumnName(column, locale);
  const description = (locale === "zh-CN" ? column.descriptionZh : column.descriptionEn)?.trim();
  const latest = column.posts[0]?.publishedAt;

  return (
    <main className="wrap news-column-page">
      <JsonLd data={collectionPageJsonLd(locale, `/news/columns/${column.slug}`, name, description || name, tr(locale, "Ongoing news column", "长期新闻栏目"))} />
      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Home", "首页"), path: "/" },
        { name: tr(locale, "News", "新鲜事"), path: "/news" },
        { name, path: `/news/columns/${column.slug}` },
      ])} />
      <nav aria-label={tr(locale, "Breadcrumb", "面包屑")} className="mono" style={{ fontSize: 11, color: "var(--faint)", margin: "16px 0 12px" }}>
        <Link href={localePath(locale, "/news")}>{tr(locale, "News", "新鲜事")}</Link>
      </nav>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Column", "栏目")} · {newsCadenceLabel(column.cadence, locale)}</div>
        <h1>{name}</h1>
        {description ? <p className="sub measure">{description}</p> : null}
        <p className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>
          {column.posts.length} {tr(locale, "editions", "期")}
          {latest ? ` · ${tr(locale, "latest", "最新")} ${newsDateLabel(latest, locale)}` : ""}
        </p>
      </div>
      <section className="blk news-day" aria-label={name}>
        <div className="news-stream">
          {column.posts.map((post) => <NewsRow post={post} locale={locale} key={post.id} />)}
        </div>
      </section>
      <p className="sub mt-18">
        <Link href={localePath(locale, "/news")}>{tr(locale, "All news", "全部新鲜事")} →</Link>
      </p>
    </main>
  );
}
