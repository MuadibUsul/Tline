import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, institutionName, localePath, tr } from "@/lib/i18n";
import { listIndexableTopicsFor, topicPath } from "@/lib/topics";
import { listPublicInstitutions } from "@/lib/institutionDirectory";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, localizedUrl, ogImage } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * 分类 — the one entrance to the two ways this site is organised: by subject, and by the
 * publishing house behind a report.
 *
 * The standalone hubs keep their addresses and their own structured data; this page is a
 * hub of hubs, so it links them rather than replacing them. Both lists come from the same
 * functions those pages use, and the institution count is the gate-admitted subset.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const [topics, institutions] = await Promise.all([listIndexableTopicsFor(locale), listPublicInstitutions()]);
  const title = tr(locale, "Categories", "分类");
  const description = clamp(tr(
    locale,
    `Browse Tlines by subject or by publisher: ${topics.length} cross-institution topics and ${institutions.length} institutions whose reports passed the publication gate.`,
    `按主题或机构浏览 Tlines：${topics.length} 个跨机构主题，${institutions.length} 家通过公开闸门的发布机构。`,
  ), 158);
  return {
    ...canonical("/categories", locale),
    // Both lists empty is a shell, not a page worth indexing.
    ...(topics.length + institutions.length < 3 ? { robots: { index: false, follow: true } } : {}),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: {
      type: "website",
      title,
      description,
      url: localizedUrl("/categories", locale),
      locale,
      images: [{ url: ogImage("Categories", title, tr(locale, "Browse by subject and publisher", "按主题与机构浏览")), width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CategoriesPage() {
  const locale = await getLocale();
  const [topics, institutions] = await Promise.all([listIndexableTopicsFor(locale), listPublicInstitutions()]);
  const totalReports = institutions.reduce((sum, institution) => sum + institution._count.articles, 0);

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(
        locale,
        "/categories",
        tr(locale, "Categories", "分类"),
        tr(locale, "Every subject and every publishing house Tlines covers.", "Tlines 收录的全部研究主题与发布机构。"),
        tr(locale, "Subject and institution categories", "主题与机构分类"),
      )} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Categories", "分类"), path: "/categories" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Categories", "分类")}</div>
        <h1>{tr(locale, "Categories", "分类")}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            `Two ways into the corpus: ${topics.length} subjects with cross-institution coverage, and ${institutions.length} publishing houses behind ${totalReports.toLocaleString(locale)} gate-admitted reports.`,
            `从这里进入全部内容：${topics.length} 个具备跨机构覆盖的研究主题，以及 ${institutions.length} 家发布机构、${totalReports.toLocaleString(locale)} 篇通过公开闸门的研报。`)}
        </p>
      </div>

      <section className="blk" aria-label={tr(locale, "Research topics", "研究主题")}>
        <div className="section-t" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
          <span>{tr(locale, "Topics", "主题")} <span className="mono" style={{ color: "var(--faint)" }}>{topics.length}</span></span>
          <Link href={localePath(locale, "/topics")}>{tr(locale, "Topic hub", "主题页")} →</Link>
        </div>
        <div className="ctiles">
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
        </div>
      </section>

      <section className="blk" aria-label={tr(locale, "Publishing institutions", "发布机构")}>
        <div className="section-t" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14 }}>
          <span>{tr(locale, "Institutions", "机构")} <span className="mono" style={{ color: "var(--faint)" }}>{institutions.length}</span></span>
          <Link href={localePath(locale, "/institutions-directory")}>{tr(locale, "Institution directory", "机构目录")} →</Link>
        </div>
        <div className="ctiles">
          {institutions.map((institution) => (
            <Link className="ctile" href={localePath(locale, `/institution/${institution.slug}`)} key={institution.slug}>
              <div className="a" style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
                {institutionName(institution.name, locale)}
              </div>
              <div className="meta">
                <span>{institution.country ?? tr(locale, "International", "国际")}</span>
                <span>{institution._count.articles.toLocaleString(locale)} {tr(locale, "reports", "篇研报")}</span>
              </div>
            </Link>
          ))}
          {institutions.length === 0 && <div className="empty-state">{tr(locale, "No institution has a report through the gate yet.", "暂无机构拥有通过公开闸门的研报。")}</div>}
        </div>
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
