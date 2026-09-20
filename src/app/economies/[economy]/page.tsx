import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ResearchCard } from "@/app/_components/ui";
import { queryClassifiedArticleIds } from "@/lib/classification/query";
import { taxonomy } from "@/lib/classification/taxonomy";
import type { JurisdictionKey } from "@/lib/classification/types";
import { prisma } from "@/lib/db";
import { formatDate, getLocale, localePath, tr, type Locale } from "@/lib/i18n";
import { publicationReadyWhere } from "@/lib/publication";
import { JsonLd, breadcrumbJsonLd, canonical, collectionPageJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = { economy: string };
const BANK_CODES: Partial<Record<JurisdictionKey, string>> = {
  us: "FED", eurozone: "ECB", uk: "BOE", japan: "BOJ", china: "PBOC", indonesia: "BI",
  australia: "RBA", "new-zealand": "RBNZ", canada: "BOC", switzerland: "SNB",
};

const economyDefinition = (slug: string) => taxonomy.jurisdictions.find((item) => item.slug === slug) ?? null;
const label = (locale: Locale, item: { nameEn: string; nameZh: string }) => locale === "zh-CN" ? item.nameZh : item.nameEn;
const dec = (value: { toString(): string } | null | undefined) => value === null || value === undefined ? "—" : value.toString();

const loadEconomy = cache(async (slug: string, locale: Locale) => {
  const economy = economyDefinition(slug);
  if (!economy) return null;
  const articleIds = await queryClassifiedArticleIds({ jurisdictions: [economy.key] }, 100);
  const bankCode = BANK_CODES[economy.key];
  const [articleCandidates, indicators, releases, policies] = await Promise.all([
    articleIds.length ? prisma.article.findMany({
      where: publicationReadyWhere({ id: { in: articleIds } }, locale),
      orderBy: { publishedAt: "desc" },
      take: 100,
      include: {
        institution: true,
        analysis: true,
        translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } },
        articleAssets: { include: { asset: true } },
        classification: { include: { jurisdictions: true, topics: true, institutions: true } },
      },
    }) : [],
    prisma.macroIndicator.findMany({
      where: { countryCode: economy.code, enabled: true },
      orderBy: [{ importance: "desc" }, { nameEn: "asc" }],
      take: 12,
      include: { seriesSources: { where: { enabled: true }, orderBy: { priority: "asc" }, include: { observations: { orderBy: [{ period: "desc" }, { vintageAt: "desc" }], take: 1 } } } },
    }),
    prisma.macroRelease.findMany({
      where: { countryCode: economy.code },
      orderBy: { scheduledAt: "desc" },
      take: 8,
      include: { values: { take: 1, include: { indicator: true } } },
    }),
    bankCode ? prisma.macroPolicyDocument.findMany({ where: { centralBank: bankCode }, orderBy: { publishedAt: "desc" }, take: 6 }) : [],
  ]);
  const isPrimary = (article: typeof articleCandidates[number]) => article.classification?.jurisdictions.some(
    (jurisdiction) => jurisdiction.jurisdictionKey === economy.key && jurisdiction.role === "PRIMARY",
  ) ?? false;
  const primaryArticles = articleCandidates.filter(isPrimary).slice(0, 6);
  const articles = [
    ...primaryArticles,
    ...articleCandidates.filter((article) => !isPrimary(article)).slice(0, 9 - primaryArticles.length),
  ];
  return { economy, articles, indicators, releases, policies };
});

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { economy: slug } = await props.params;
  const locale = await getLocale();
  const item = economyDefinition(slug);
  if (!item) return { title: tr(locale, "Economy not found", "经济体未找到") };
  const name = label(locale, item);
  return {
    ...canonical(`/economies/${item.slug}`, locale),
    title: tr(locale, `${name} economy dashboard`, `${name}经济看板`),
    description: tr(locale, `${name} macro data, central-bank policy, related markets and institutional research.`, `${name}的宏观数据、央行政策、相关市场与机构研报。`),
  };
}

export default async function EconomyPage(props: { params: Promise<Params> }) {
  const { economy: slug } = await props.params;
  const locale = await getLocale();
  const data = await loadEconomy(slug, locale);
  if (!data) notFound();
  const { economy, articles, indicators, releases, policies } = data;
  const name = label(locale, economy);
  const centralBank = taxonomy.institutions.find((item) => item.jurisdictionKey === economy.key && item.kind === "CENTRAL_BANK");

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, `/economies/${economy.slug}`, name, tr(locale, `${name} macro and institutional intelligence.`, `${name}宏观与机构情报。`), name)} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Economies", "经济体"), path: "/economies" }, { name, path: `/economies/${economy.slug}` }])} />
      <nav aria-label={tr(locale, "Breadcrumb", "面包屑")} className="mono" style={{ fontSize: 11, color: "var(--faint)", marginBottom: 12 }}>
        <Link href={localePath(locale, "/economies")}>{tr(locale, "Economies", "经济体")}</Link>
      </nav>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Economy", "经济体")} · {economy.code}</div>
        <h1>{name}</h1>
        <p className="sub">{tr(locale, `Latest ${name} releases, policy documents, indicators and institution research. Research includes primary and explicitly related coverage.`, `${name}最新的宏观发布、政策文件、指标与机构研报。研报包含主要归属及明确涉及该经济辖区的内容。`)}</p>
        <div className="tag-row">
          {centralBank && <span className="chip acc">{locale === "zh-CN" ? centralBank.nameZh : centralBank.nameEn}</span>}
          <Link className="chip gray" href={localePath(locale, `/research?jurisdiction=${economy.key}`)}>{tr(locale, "Filtered research", "筛选研报")}</Link>
        </div>
      </div>

      <div className="markets-grid">
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Latest macro releases", "最新宏观发布")}</h2>
          <div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Date", "日期")}</th><th>{tr(locale, "Release", "发布")}</th><th>{tr(locale, "Actual", "实际")}</th></tr></thead><tbody>
            {releases.map((release) => <tr key={release.id}><td className="mono-cell">{formatDate(release.releasedAt ?? release.scheduledAt, locale)}</td><td className="inst"><Link href={localePath(locale, `/macro/release/${release.id}`)}>{locale === "zh-CN" ? release.titleZh ?? release.titleEn : release.titleEn}</Link></td><td className="mono-cell num">{dec(release.values[0]?.actualInitial)}</td></tr>)}
            {releases.length === 0 && <tr><td colSpan={3}>{tr(locale, "No structured releases yet.", "尚无结构化发布数据。")}</td></tr>}
          </tbody></table></div>
        </section>
        <section className="blk">
          <h2 className="section-t">{tr(locale, "Latest indicators", "最新指标")}</h2>
          <div className="tbl-wrap"><table><thead><tr><th>{tr(locale, "Indicator", "指标")}</th><th>{tr(locale, "Latest", "最新")}</th><th>{tr(locale, "Period", "参考期")}</th></tr></thead><tbody>
            {indicators.map((indicator) => { const latest = indicator.seriesSources.find((source) => source.observations.length)?.observations[0]; return <tr key={indicator.id}><td className="inst"><Link href={localePath(locale, `/macro/indicator/${indicator.canonicalKey}`)}>{locale === "zh-CN" ? indicator.nameZh ?? indicator.nameEn : indicator.nameEn}</Link></td><td className="mono-cell num">{dec(latest?.value)}</td><td className="mono-cell">{latest ? formatDate(latest.period, locale) : "—"}</td></tr>; })}
            {indicators.length === 0 && <tr><td colSpan={3}>{tr(locale, "No structured indicators yet.", "尚无结构化指标。")}</td></tr>}
          </tbody></table></div>
        </section>
      </div>

      {policies.length > 0 && <section className="blk"><h2 className="section-t">{tr(locale, "Central-bank policy documents", "央行政策文件")}</h2><div className="rowlist">{policies.map((document) => <div className="r" key={document.id}><span><b>{document.docType}</b><small>{formatDate(document.publishedAt, locale)} · {document.reviewStatus}</small></span><a className="minibtn" href={document.sourceUrl} target="_blank" rel="noopener noreferrer">{tr(locale, "Official source ↗", "官方来源 ↗")}</a></div>)}</div></section>}

      <section className="blk">
        <h2 className="section-t">{tr(locale, "Institutional research", "机构研报")}</h2>
        {articles.length ? <div className="research-grid">{articles.map((article) => <ResearchCard key={article.id} a={article} locale={locale} />)}</div> : <div className="empty-state">{tr(locale, "No publication-ready classified research for this economy yet.", "该经济体暂时没有已分类且可公开的研报。")}</div>}
      </section>
    </main>
  );
}
