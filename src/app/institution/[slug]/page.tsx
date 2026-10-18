import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cardArticleSelect, getInstitutionView, withPreviewBodies } from "@/lib/queries";
import { FeedCard, DirChip, relTime, ResearchCard } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";
import { assetName, domainTerm, getLocale, institutionName, LOCALES, tr, localePath } from "@/lib/i18n";
import { breadcrumbJsonLd, canonical, institutionProfileJsonLd, itemListJsonLd, JsonLd, localizedUrl, ogImage, webPageJsonLd } from "@/lib/seo";
import { getInstitutionAssets, getInstitutionTopics, topicHref } from "@/lib/related";
import { assetPath } from "@/lib/assetPath";
import { publicationReadyWhere } from "@/lib/publication";
import { queryClassifiedArticleIds } from "@/lib/classification/query";
import { taxonomy } from "@/lib/classification/taxonomy";
import { institutionSeoProfile, subjectInstitutionSeoProfile } from "@/lib/seoLanding";
import { formatAssetTarget } from "@/lib/assetTarget";
import { Icon } from "@/app/_components/Icon";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const institution = await prisma.institution.findUnique({
    where: { slug },
    select: { name: true, country: true, articles: { where: publicationReadyWhere(), select: { indexableEn: true, indexableZh: true } } },
  });
  if (!institution) {
    const subject = taxonomy.institutions.find((item) => item.key === slug);
    if (!subject) return { title: tr(locale, "Institution not found", "机构未找到") };
    const name = locale === "zh-CN" ? subject.nameZh : subject.nameEn;
    const articleIds = await queryClassifiedArticleIds({ institutions: [subject.key] }, 500);
    const allCoverage = articleIds.length ? await prisma.article.findMany({
      where: publicationReadyWhere({ id: { in: articleIds } }),
      select: { institutionId: true, indexableEn: true, indexableZh: true },
    }) : [];
    const coverage = allCoverage.filter((row) => locale === "zh-CN" ? row.indexableZh : row.indexableEn);
    const availableLocales = LOCALES.filter((language) => allCoverage.some((row) => language === "zh-CN" ? row.indexableZh : row.indexableEn));
    const profile = subjectInstitutionSeoProfile(subject.key, name, locale, coverage.length, new Set(coverage.map((row) => row.institutionId)).size);
    return {
      ...canonical(`/institution/${slug}`, locale, availableLocales),
      title: { absolute: profile.title },
      description: profile.description,
      ...(coverage.length ? {} : { robots: { index: false, follow: true } }),
    };
  }
  const name = institutionName(institution.name, locale);
  const reportCount = institution.articles.filter((article) => locale === "zh-CN" ? article.indexableZh : article.indexableEn).length;
  const availableLocales = LOCALES.filter((language) => institution.articles.some((article) => language === "zh-CN" ? article.indexableZh : article.indexableEn));
  const profile = institutionSeoProfile(slug, name, locale, reportCount);
  return {
    title: { absolute: profile.title },
    description: profile.description,
    ...canonical(`/institution/${slug}`, locale, availableLocales),
    ...(reportCount ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: "website", title: profile.title, description: profile.description, url: localizedUrl(`/institution/${slug}`, locale), locale, images: [{ url: ogImage("Institution", institution.name, institution.country ?? undefined), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: profile.title, description: profile.description },
  };
}


export default async function InstitutionPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getInstitutionView(params.slug, locale);
  if (!data) {
    const subject = taxonomy.institutions.find((item) => item.key === params.slug);
    if (!subject) notFound();
    const articleIds = await queryClassifiedArticleIds({ institutions: [subject.key] }, 500);
    const [articles, coverageRows] = articleIds.length ? await Promise.all([
      withPreviewBodies(await prisma.article.findMany({
        where: publicationReadyWhere({ id: { in: articleIds } }, locale),
        orderBy: { publishedAt: "desc" },
        take: 12,
        select: cardArticleSelect,
      }), locale),
      prisma.article.findMany({
        where: publicationReadyWhere({ id: { in: articleIds } }, locale),
        select: { institutionId: true },
      }),
    ]) : [[], []];
    const name = locale === "zh-CN" ? subject.nameZh : subject.nameEn;
    const publisherCount = new Set(coverageRows.map((article) => article.institutionId)).size;
    const profile = subjectInstitutionSeoProfile(subject.key, name, locale, coverageRows.length, publisherCount);
    return (
      <main className="wrap">
        <JsonLd data={webPageJsonLd(locale, `/institution/${subject.key}`, profile.h1, profile.description, "CollectionPage")} />
        <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Institutions", "机构"), path: "/institutions" }, { name, path: `/institution/${subject.key}` }])} />
        <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}><Link href={localePath(locale, "/institutions")}>{tr(locale, "Institutions", "机构")}</Link><span>›</span><span>{name}</span></nav>
        <div className="page-head">
          <div className="eyebrow">{tr(locale, "Subject institution", "内容涉及机构")}</div>
          <h1>{profile.h1}</h1>
          <p className="sub">{tr(locale, `Policy and research about ${name}. The publishing institution remains a separate field on every report.`, `关于${name}的政策与研究。每篇研报的发布机构仍作为独立字段展示。`)}</p>
          <div className="tag-row">
            <Link className="chip acc" href={localePath(locale, `/economies/${subject.jurisdictionKey}`)}>{tr(locale, "Economy dashboard", "经济体看板")}</Link>
            <Link className="chip gray" href={localePath(locale, `/research?subjectInstitution=${subject.key}`)}>{tr(locale, "Filtered research", "筛选研报")}</Link>
          </div>
        </div>
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Related institutional research", "相关机构研报")}</h2>
          {articles.length ? <div className="research-grid">{articles.map((article) => <ResearchCard key={article.id} a={article} locale={locale} />)}</div> : <div className="empty-state">{tr(locale, "No publication-ready classified research yet.", "暂时没有已分类且可公开的相关研报。")}</div>}
        </section>
      </main>
    );
  }
  const { inst, articles, count30, views, coverage } = data;
  // Where this publisher concentrates, and on what. Both are counted from its own rows.
  const [mainAssets, mainTopics] = await Promise.all([
    getInstitutionAssets(inst.slug),
    getInstitutionTopics(inst.slug, locale),
  ]);
  const profile = institutionSeoProfile(inst.slug, institutionName(inst.name, locale), locale, articles.length);

  return (
    <main className="wrap">
      <JsonLd data={institutionProfileJsonLd(locale, `/institution/${inst.slug}`, profile.h1, profile.description, inst.researchUrl)} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Institutions", "机构"), path: "/institutions" }, { name: institutionName(inst.name, locale), path: `/institution/${inst.slug}` }])} />
      {/* The assets in the Current Views table, in that order. */}
      {views.length > 0 && <JsonLd data={itemListJsonLd(locale, `/institution/${inst.slug}`, tr(locale, `Assets ${inst.name} currently covers`, `${inst.name}当前覆盖的资产`), views.slice(0, 25).map((view) => ({ name: assetName(view.name, locale, view.ticker), path: assetPath(view.ticker) })))} />}
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}><Link href={localePath(locale, "/institutions")}>{tr(locale, "Institutions", "机构")}</Link><span>›</span><span>{institutionName(inst.name, locale)}</span></nav>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Institution", "机构")}</div>
        <h1>{profile.h1}</h1>
        {/* Required by the brand rules: this page must never read as the institution's own. */}
        <p className="sub measure text-muted">
          {tr(locale,
            `Tlines indexes and structures research that ${inst.name} publishes publicly. Tlines is not affiliated with, endorsed by, or acting on behalf of ${inst.name}, and takes no position on the views shown.`,
            `Tlines 仅对 ${inst.name} 公开发布的研究进行索引与结构化整理，与 ${inst.name} 无关联、未经其授权或背书，也不对相关观点持立场。`)}
        </p>
        <div className="deltas">
          <span className="stars">{"★".repeat(inst.rating)}{"☆".repeat(5 - inst.rating)}</span>
          <span>{tr(locale, "Authority weight", "权威权重")} <b className="mono">{inst.authorityScore.toFixed(2)}</b></span>
          <span>{tr(locale, "Public views · 30d", "公开观点 · 30天")} <b className="mono">{count30}</b></span>
          {coverage.length > 0 && <span className="text-tertiary">{coverage.map((item) => domainTerm(item, locale)).join(" · ")}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={inst.researchUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Research homepage ↗", "研报主页 ↗")}</a>
          <Link href={localePath(locale, `/institution/${inst.slug}/accuracy`)} className="minibtn">{tr(locale, "Forecast accuracy", "预测准确率")}</Link>
          <form action={addWatch}>
            <input type="hidden" name="kind" value="institution" />
            <input type="hidden" name="refId" value={inst.slug} />
            <input type="hidden" name="back" value={`/institution/${inst.slug}`} />
            <button type="submit" className="minibtn"><Icon name="plus" /> {tr(locale, "Watch", "关注")}</button>
          </form>
        </div>
      </div>

      {views.length > 0 && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Current Views", "当前观点")}</h2>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>{tr(locale, "Asset", "资产")}</th><th>{tr(locale, "Direction", "方向")}</th><th>{tr(locale, "Target", "目标价")}</th><th>{tr(locale, "Updated", "更新于")}</th></tr></thead>
              <tbody>
                {views.map((v) => (
                  <tr key={v.ticker}>
                    <td className="inst"><Link href={localePath(locale, assetPath(v.ticker))}>{assetName(v.name, locale, v.ticker)}</Link></td>
                    <td><DirChip direction={v.direction} locale={locale} /></td>
                    <td className="mono-cell">{v.target !== null ? formatAssetTarget(v.ticker, v.target, locale) : "—"}</td>
                    <td className="mono-cell">{relTime(v.when, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(mainAssets.length > 0 || mainTopics.length > 0) && (
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Where this publisher concentrates", "该机构的主要覆盖")}</h2>
          {mainAssets.length > 0 && <div className="tag-row" style={{ marginBottom: mainTopics.length ? 14 : 0 }}>
            {mainAssets.map((asset) => <Link className="chip acc" key={asset.ticker} href={localePath(locale, assetPath(asset.ticker))}>{assetName(asset.name, locale, asset.ticker)} · {asset.ticker}</Link>)}
          </div>}
          {mainTopics.length > 0 && <div className="tag-row">
            {mainTopics.map((topic) => <Link className="chip gray" key={topic.key} href={localePath(locale, topicHref(topic.key))}>{topic.label} · {topic.views}</Link>)}
          </div>}
          <p className="sub text-muted mt-12">
            {tr(locale, "Counted from this publisher's own indexed reports. ", "按该机构已收录研报统计。")}
            <Link href={localePath(locale, `/institution/${inst.slug}/accuracy`)}>{tr(locale, "Forecast record — how its settled calls turned out", "预测记录：已结算观点的实际结果")}</Link>
          </p>
        </section>
      )}

      <section style={{ paddingTop: 26 }}>
        <h2 className="section-t">{tr(locale, "Recent Research", "近期研报")}</h2>
        <div className="feed">
          {articles.slice(0, 10).map((a) => (
            <FeedCard key={a.id} a={{ ...a, institution: { name: inst.name, slug: inst.slug } }} locale={locale} />
          ))}
          {articles.length === 0 && <p className="mono text-muted">{tr(locale, "No ingested research yet for this source.", "该来源暂无已入库研报。")}</p>}
        </div>
      </section>
    </main>
  );
}
