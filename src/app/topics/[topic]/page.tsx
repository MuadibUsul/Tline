import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { assetName, getLocale, institutionName, localePath, relativeTime, tr, type Locale } from "@/lib/i18n";
import { assetPath } from "@/lib/assetPath";
import { ResearchCard } from "@/app/_components/ui";
import { getTopicArticleIds, getTopicStat, getTopicViews, topicPath, TOPIC_MIN_ARTICLES } from "@/lib/topics";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, itemListJsonLd, localizedUrl, ogImage } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** A Chinese page needs enough translated views to be worth showing, or it is a shell. */
const ZH_MIN_VIEWS = 3;

type TopicParams = { topic: string };

const directionLabel = (direction: string, locale: Locale) => {
  if (locale === "en") return direction;
  return ({ bullish: "看多", bearish: "看空", neutral: "中性", conditional: "条件性" } as Record<string, string>)[direction] ?? direction;
};
const directionTone = (direction: string) => (direction === "bullish" ? "bull" : direction === "bearish" ? "bear" : "neu");

const loadTopic = cache(async (key: string, locale: Locale) => {
  const stat = await getTopicStat(key);
  if (!stat) return null;
  const [views, articleIds] = await Promise.all([getTopicViews(key, locale), getTopicArticleIds(key)]);
  const usableViews = locale === "zh-CN" ? views.filter((view) => view.view?.trim()) : views;
  const articles = articleIds.length
    ? await prisma.article.findMany({
        where: publicationReadyWhere({ id: { in: articleIds } }),
        orderBy: { publishedAt: "desc" },
        take: 9,
        select: {
          id: true, slug: true, title: true, publishedAt: true, createdAt: true, sourceUrl: true,
          institution: { select: { name: true, slug: true } },
          analysis: { select: { summary: true, summaryZh: true } },
          translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } },
          articleAssets: { select: { direction: true, target: true, previousTarget: true, asset: { select: { ticker: true, name: true } } } },
        },
      })
    : [];
  return { stat, views: usableViews, articles };
});

export async function generateMetadata(props: { params: Promise<TopicParams> }): Promise<Metadata> {
  const { topic } = await props.params;
  const locale = await getLocale();
  const data = await loadTopic(topic, locale);
  if (!data) return { title: tr(locale, "Topic not found", "主题未找到") };
  const { stat } = data;
  const label = locale === "zh-CN" ? stat.labelZh : stat.labelEn;
  const title = clamp(locale === "zh-CN"
    ? `${label}：机构观点与研报`
    : `${label} — institutional views, forecasts and research`, 60);
  const description = tr(
    locale,
    `${stat.institutions} institutions have published ${stat.articles} reports touching ${label}. Compare their views, the assets involved and the source reports.`,
    `${stat.institutions} 家机构发布了 ${stat.articles} 篇涉及${label}的研报。比较各家观点、涉及的资产与原始研报。`,
  ).slice(0, 158);
  // Chinese is declared only when the translated views actually exist: an hreflang pair where
  // one side is an empty page tells a search engine the site has a translation it does not have.
  const availableLocales: Locale[] = data.views.length >= ZH_MIN_VIEWS ? ["en", "zh-CN"] : ["en"];
  const indexable = data.articles.length >= TOPIC_MIN_ARTICLES && data.views.length > 0;
  return {
    ...canonical(topicPath(stat.key), locale, locale === "zh-CN" ? availableLocales : ["en", "zh-CN"]),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    // Absolute: the topic name leads and the layout's " · Tlines" suffix would push a
    // 60-character subject past the width a result shows.
    title: { absolute: title },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl(topicPath(stat.key), locale), locale, images: [{ url: ogImage("Topic", label, tr(locale, "Institutional views and source reports", "机构观点与原始研报")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TopicPage(props: { params: Promise<TopicParams> }) {
  const { topic } = await props.params;
  const locale = await getLocale();
  const data = await loadTopic(topic, locale);
  if (!data) notFound();
  const { stat, views, articles } = data;
  const label = locale === "zh-CN" ? stat.labelZh : stat.labelEn;
  // Only assets that are themselves covered pages, so a topic never links somewhere that 404s.
  const covered = stat.tickers.length
    ? await prisma.asset.findMany({
        where: { ticker: { in: stat.tickers } },
        select: { ticker: true, name: true, articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true } } } } },
      })
    : [];
  const assetLinks = covered
    .map((asset) => ({ ...asset, institutions: new Set(asset.articleAssets.map((item) => item.article.institutionId)).size }))
    .filter((asset) => asset.institutions >= 2);
  const institutions = [...new Map(views.map((view) => [view.article.institution.slug, view.article.institution])).values()];

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, topicPath(stat.key), label, tr(locale, `Institutional views and reports on ${label}.`, `关于${label}的机构观点与研报。`), label)} />
      {assetLinks.length > 0 && (
        <JsonLd data={itemListJsonLd(locale, topicPath(stat.key), tr(locale, `Assets in ${label} coverage`, `${label}涉及的资产`), assetLinks.map((asset) => ({ name: `${assetName(asset.name, locale, asset.ticker)} (${asset.ticker})`, path: assetPath(asset.ticker) })))} />
      )}
      <JsonLd data={breadcrumbJsonLd(locale, [
        { name: tr(locale, "Home", "首页"), path: "/" },
        { name: tr(locale, "Topics", "主题"), path: "/topics" },
        { name: label, path: topicPath(stat.key) },
      ])} />

      <nav aria-label={tr(locale, "Breadcrumb", "面包屑")} className="mono" style={{ fontSize: 11, color: "var(--faint)", marginBottom: 12 }}>
        <Link href={localePath(locale, "/topics")}>{tr(locale, "Topics", "主题")}</Link>
      </nav>

      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Topic", "主题")}</div>
        <h1>{label}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            `${stat.institutions} institutions have written about this across ${stat.articles} indexed reports, producing ${stat.views} extracted views. The claims below are quoted from those reports; each links to the report it came from and to the asset it concerns.`,
            `${stat.institutions} 家机构在 ${stat.articles} 篇已收录研报中讨论了该主题，共提取出 ${stat.views} 条观点。以下主张来自这些研报，每条都链接到原始研报与相关资产。`)}
        </p>
        <p className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
          {tr(locale, "Last updated ", "最后更新 ")}
          <time dateTime={stat.lastAt.toISOString()}>{relativeTime(stat.lastAt, locale)}</time>
          {" · "}
          <Link href={localePath(locale, "/methodology")}>{tr(locale, "How views are extracted", "观点如何提取")}</Link>
          {" · "}
          <Link href={localePath(locale, "/sources")}>{tr(locale, "Source policy", "来源政策")}</Link>
        </p>
      </div>

      {views.length > 0 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "What institutions are saying", "机构在说什么")}</h2>
          <div className="rowlist">
            {views.map((view) => (
              <div className="r" key={view.id} style={{ display: "block", paddingTop: 10, paddingBottom: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", marginBottom: 6 }}>
                  <Link href={localePath(locale, `/institution/${view.article.institution.slug}`)} className="mono" style={{ fontSize: 12 }}>
                    {institutionName(view.article.institution.name, locale)}
                  </Link>
                  <span className={`chip ${directionTone(view.direction)}`}>{directionLabel(view.direction, locale)}</span>
                  {view.assetTicker && <Link href={localePath(locale, assetPath(view.assetTicker))} className="chip acc">{assetName(view.asset, locale, view.assetTicker, "相关资产")} · {view.assetTicker}</Link>}
                  <time className="mono" style={{ fontSize: 11, color: "var(--faint)" }} dateTime={view.article.publishedAt.toISOString()}>{relativeTime(view.article.publishedAt, locale)}</time>
                </div>
                <Link href={localePath(locale, `/research/${view.article.slug}`)} style={{ color: "var(--ink)" }}>{view.view}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {assetLinks.length > 0 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Assets in this coverage", "该主题涉及的资产")}</h2>
          <div className="tag-row">
            {assetLinks.map((asset) => (
              <Link key={asset.ticker} className="chip acc" href={localePath(locale, assetPath(asset.ticker))}>
                {assetName(asset.name, locale, asset.ticker)} · {asset.ticker}
              </Link>
            ))}
          </div>
        </section>
      )}

      {institutions.length > 1 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Institutions writing on this", "讨论该主题的机构")}</h2>
          <div className="tag-row">
            {institutions.map((institution) => (
              <Link key={institution.slug} className="chip gray" href={localePath(locale, `/institution/${institution.slug}`)}>
                {institutionName(institution.name, locale)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {articles.length > 0 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Reports behind this topic", "该主题背后的研报")}</h2>
          <div className="research-grid">
            {articles.map((article) => <ResearchCard key={article.id} a={article} locale={locale} />)}
          </div>
          <p className="sub" style={{ marginTop: 12 }}>
            <Link href={localePath(locale, "/research")}>{tr(locale, "All research", "全部研报")}</Link>
            {" · "}
            <Link href={localePath(locale, "/topics")}>{tr(locale, "All topics", "全部主题")}</Link>
          </p>
        </section>
      )}
    </main>
  );
}
