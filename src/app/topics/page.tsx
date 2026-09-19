import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { listIndexableTopics, topicPath, TOPIC_MIN_ARTICLES, TOPIC_MIN_INSTITUTIONS } from "@/lib/topics";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, itemListJsonLd, localizedUrl, ogImage, topicsSeoTitle } from "@/lib/seo";
import { taxonomy } from "@/lib/classification/taxonomy";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const topics = await listIndexableTopics();
  const title = topicsSeoTitle(locale);
  const description = tr(
    locale,
    "The subjects institutions are actually writing about, each with the number of publishing houses behind it, the assets involved and the reports it comes from.",
    "机构实际在研究的主题：每个主题有多少家机构、涉及哪些资产，以及来自哪些研报。",
  );
  return {
    ...canonical("/topics", locale),
    // A hub with nothing on it is not a page, whatever it says in its own copy.
    ...(topics.length < 3 ? { robots: { index: false, follow: true } } : {}),
    title: { absolute: title },
    description: clamp(description, 158),
    openGraph: { type: "website", title, description, url: localizedUrl("/topics", locale), locale, images: [{ url: ogImage("Topics", title, tr(locale, "What institutions are researching", "机构正在研究什么")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TopicsPage() {
  const locale = await getLocale();
  const topics = await listIndexableTopics();
  const featuredKeys = ["inflation", "employment", "energy", "equities"];
  const featured = taxonomy.topics.filter((item) => featuredKeys.includes(item.key));

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/topics", topicsSeoTitle(locale), tr(locale, "Subjects with cross-institution coverage.", "具备跨机构覆盖的研究主题。"), tr(locale, "Institutional research topics", "机构研究主题"))} />
      <JsonLd data={itemListJsonLd(locale, "/topics", tr(locale, "Institutional research topics", "机构研究主题"), topics.map((topic) => ({ name: locale === "zh-CN" ? topic.labelZh : topic.labelEn, path: topicPath(topic.key) })))} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Topics", "主题"), path: "/topics" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Topics", "主题")}</div>
        <h1>{tr(locale, "What institutions are researching", "机构正在研究什么")}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            `Every subject below is carried by at least ${TOPIC_MIN_INSTITUTIONS} publishing houses across at least ${TOPIC_MIN_ARTICLES} reports, taken from the views extracted from those reports. A subject that only one institution writes about is not listed — it has no cross-institution read to show.`,
            `下列每个主题都至少由 ${TOPIC_MIN_INSTITUTIONS} 家机构、${TOPIC_MIN_ARTICLES} 篇研报支撑，数据来自这些研报中提取的观点。只有一家机构讨论的主题不会列出——它没有可展示的跨机构视角。`)}
        </p>
      </div>
      <section className="blk" aria-label={tr(locale, "Featured structured sections", "重点结构化专区")}>
        <h2 className="section-t">{tr(locale, "Featured sections", "重点专区")}</h2>
        <div className="tag-row">
          <Link className="chip acc" href={localePath(locale, "/institution/federal-reserve")}>{tr(locale, "Federal Reserve", "美联储")}</Link>
          {featured.map((topic) => <Link className="chip acc" href={localePath(locale, topicPath(topic.key))} key={topic.key}>{locale === "zh-CN" ? topic.nameZh : topic.nameEn}</Link>)}
        </div>
        <p className="sub">{tr(locale, "Topic sections can be narrowed by economy; the Federal Reserve section is institution-based rather than a fake topic.", "主题专区可按经济体筛选；美联储专区按机构关系构建，不创建虚假的美联储主题。")}</p>
      </section>
      <section className="ctiles" aria-label={tr(locale, "Research topics", "研究主题")}>
        {topics.map((topic) => (
          <Link className="ctile" href={localePath(locale, topicPath(topic.key))} key={topic.key}>
            <div className="a">{locale === "zh-CN" ? topic.labelZh : topic.labelEn}</div>
            <div className="meta">
              <span>{topic.institutions}{tr(locale, " institutions", "家机构")}</span>
              <span>{topic.articles}{tr(locale, " reports", "篇研报")}</span>
              <span>{topic.views}{tr(locale, " views", "条观点")}</span>
            </div>
          </Link>
        ))}
        {topics.length === 0 && <div className="empty-state">{tr(locale, "No subject has enough cross-institution coverage yet.", "暂无主题达到跨机构覆盖门槛。")}</div>}
      </section>
      <p className="sub" style={{ color: "var(--muted)", marginTop: 18 }}>
        <Link href={localePath(locale, "/markets")}>{tr(locale, "Browse by asset", "按资产浏览")}</Link>
        {" · "}
        <Link href={localePath(locale, "/institutions")}>{tr(locale, "Browse by view", "按观点浏览")}</Link>
        {" · "}
        <Link href={localePath(locale, "/methodology")}>{tr(locale, "How topics are derived", "主题如何得出")}</Link>
      </p>
    </main>
  );
}
