import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionView } from "@/lib/queries";
import { FeedCard, DirChip, relTime, ResearchCard } from "@/app/_components/ui";
import { addWatch } from "@/app/actions";
import { assetName, domainTerm, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { breadcrumbJsonLd, canonical, institutionProfileJsonLd, institutionSeoTitle, itemListJsonLd, JsonLd, localizedUrl, ogImage } from "@/lib/seo";
import { getInstitutionAssets, getInstitutionTopics, topicHref } from "@/lib/related";
import { assetPath } from "@/lib/assetPath";
import { publicationReadyWhere } from "@/lib/publication";
import { queryClassifiedArticleIds } from "@/lib/classification/query";
import { taxonomy } from "@/lib/classification/taxonomy";

export const dynamic = "force-dynamic";
export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const locale = await getLocale();
  const institution = await prisma.institution.findUnique({
    where: { slug },
    select: { name: true, country: true, _count: { select: { articles: { where: publicationReadyWhere() } } } },
  });
  if (!institution) {
    const subject = taxonomy.institutions.find((item) => item.key === slug);
    if (!subject) return { title: tr(locale, "Institution not found", "机构未找到") };
    const name = locale === "zh-CN" ? subject.nameZh : subject.nameEn;
    return {
      ...canonical(`/institution/${slug}`, locale),
      title: tr(locale, `${name} policy and related research`, `${name}政策与相关研报`),
      description: tr(locale, `Policy documents and research whose subject is ${name}, distinct from the report publisher.`, `以${name}为内容主体的政策文件与研报，与研报发布机构明确区分。`),
    };
  }
  const name = institutionName(institution.name, locale);
  const title = institutionSeoTitle(name, locale);
  const description = tr(
    locale,
    `What ${name}${institution.country ? ` (${institution.country})` : ""} is currently forecasting: their published views by asset, the targets attached to them, and every source-linked report behind them.`,
    `${name}${institution.country ? `（${institution.country}）` : ""}当前的公开预测：按资产整理的观点、对应的目标价，以及背后的每一篇可溯源研报。`,
  ).slice(0, 158);
  return {
    title: { absolute: title },
    description,
    ...canonical(`/institution/${slug}`, locale),
    ...(institution._count.articles ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: "website", title, description, url: localizedUrl(`/institution/${slug}`, locale), locale, images: [{ url: ogImage("Institution", institution.name, institution.country ?? undefined), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}


export default async function InstitutionPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const locale = await getLocale();
  const data = await getInstitutionView(params.slug, locale);
  if (!data) {
    const subject = taxonomy.institutions.find((item) => item.key === params.slug);
    if (!subject) notFound();
    const articleIds = await queryClassifiedArticleIds({ institutions: [subject.key] }, 100);
    const articles = articleIds.length ? await prisma.article.findMany({
      where: publicationReadyWhere({ id: { in: articleIds } }, locale),
      orderBy: { publishedAt: "desc" },
      take: 12,
      include: {
        institution: true,
        analysis: true,
        translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } },
        articleAssets: { include: { asset: true } },
        classification: { include: { jurisdictions: true, topics: true, institutions: true } },
      },
    }) : [];
    const name = locale === "zh-CN" ? subject.nameZh : subject.nameEn;
    return (
      <main className="wrap">
        <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Institutions", "机构"), path: "/institutions" }, { name, path: `/institution/${subject.key}` }])} />
        <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}><Link href={localePath(locale, "/institutions")}>{tr(locale, "Institutions", "机构")}</Link><span>›</span><span>{name}</span></nav>
        <div className="page-head">
          <div className="eyebrow">{tr(locale, "Subject institution", "内容涉及机构")}</div>
          <h1>{name}</h1>
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

  return (
    <main className="wrap">
      <JsonLd data={institutionProfileJsonLd(locale, `/institution/${inst.slug}`, institutionName(inst.name, locale), tr(locale, `Structured public research, current views and source links for ${inst.name}.`, `${institutionName(inst.name, locale)}的结构化公开研报、当前观点与来源链接。`), inst.researchUrl)} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Institutions", "机构"), path: "/institutions" }, { name: institutionName(inst.name, locale), path: `/institution/${inst.slug}` }])} />
      {/* The assets in the Current Views table, in that order. */}
      {views.length > 0 && <JsonLd data={itemListJsonLd(locale, `/institution/${inst.slug}`, tr(locale, `Assets ${inst.name} currently covers`, `${inst.name}当前覆盖的资产`), views.slice(0, 25).map((view) => ({ name: assetName(view.name, locale, view.ticker), path: assetPath(view.ticker) })))} />}
      <nav className="breadcrumbs" aria-label={tr(locale, "Breadcrumb", "面包屑")}><Link href={localePath(locale, "/institutions")}>{tr(locale, "Institutions", "机构")}</Link><span>›</span><span>{institutionName(inst.name, locale)}</span></nav>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Institution", "机构")}</div>
        <h1>{tr(locale, `${institutionName(inst.name, locale)} — published research and current views`, `${institutionName(inst.name, locale)}：公开研报与当前观点`)}</h1>
        {/* Required by the brand rules: this page must never read as the institution's own. */}
        <p className="sub" style={{ color: "var(--muted)", maxWidth: "72ch" }}>
          {tr(locale,
            `Tlines indexes and structures research that ${inst.name} publishes publicly. Tlines is not affiliated with, endorsed by, or acting on behalf of ${inst.name}, and takes no position on the views shown.`,
            `Tlines 仅对 ${inst.name} 公开发布的研究进行索引与结构化整理，与 ${inst.name} 无关联、未经其授权或背书，也不对相关观点持立场。`)}
        </p>
        <div className="deltas">
          <span className="stars">{"★".repeat(inst.rating)}{"☆".repeat(5 - inst.rating)}</span>
          <span>{tr(locale, "Authority weight", "权威权重")} <b className="mono">{inst.authorityScore.toFixed(2)}</b></span>
          <span>{tr(locale, "Public views · 30d", "公开观点 · 30天")} <b className="mono">{count30}</b></span>
          {coverage.length > 0 && <span style={{ color: "var(--faint)" }}>{coverage.map((item) => domainTerm(item, locale)).join(" · ")}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={inst.researchUrl} target="_blank" rel="noopener noreferrer" className="minibtn">{tr(locale, "Research homepage ↗", "研报主页 ↗")}</a>
          <Link href={localePath(locale, `/institution/${inst.slug}/accuracy`)} className="minibtn">{tr(locale, "Forecast accuracy", "预测准确率")}</Link>
          <form action={addWatch}>
            <input type="hidden" name="kind" value="institution" />
            <input type="hidden" name="refId" value={inst.slug} />
            <input type="hidden" name="back" value={`/institution/${inst.slug}`} />
            <button type="submit" className="minibtn">＋ {tr(locale, "Watch", "关注")}</button>
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
                    <td className="mono-cell">{v.target ? `$${v.target.toLocaleString()}` : "—"}</td>
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
          <p className="sub" style={{ marginTop: 12, color: "var(--muted)" }}>
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
          {articles.length === 0 && <p className="mono" style={{ color: "var(--muted)" }}>{tr(locale, "No ingested research yet for this source.", "该来源暂无已入库研报。")}</p>}
        </div>
      </section>
    </main>
  );
}
