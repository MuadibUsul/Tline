import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { taxonomy } from "@/lib/classification/taxonomy";
import { JsonLd, breadcrumbJsonLd, canonical, collectionPageJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const featured = ["us", "eurozone", "uk", "japan"];

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    ...canonical("/economies", locale),
    title: tr(locale, "Economy dashboards", "经济体看板"),
    description: tr(locale, "Macro releases, policy institutions, markets and institutional research organized by economy.", "按经济体组织宏观发布、政策机构、市场与机构研报。"),
  };
}

export default async function EconomiesPage() {
  const locale = await getLocale();
  const economies = taxonomy.jurisdictions
    .filter((item) => featured.includes(item.key))
    .sort((a, b) => featured.indexOf(a.key) - featured.indexOf(b.key));
  const counts = await Promise.all(economies.map((economy) => prisma.classificationJurisdiction.count({
    where: { jurisdictionKey: economy.key, role: "PRIMARY", classification: { contentKind: "ARTICLE" } },
  })));

  return (
    <main className="wrap">
      <JsonLd data={collectionPageJsonLd(locale, "/economies", tr(locale, "Economy dashboards", "经济体看板"), tr(locale, "Macro and institutional intelligence grouped by economy.", "按经济体组织的宏观与机构情报。"), tr(locale, "Economies", "经济体"))} />
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Economies", "经济体"), path: "/economies" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Jurisdictions", "经济辖区")}</div>
        <h1>{tr(locale, "Economy dashboards", "经济体看板")}</h1>
        <p className="sub">{tr(locale, "Each dashboard keeps one economy's data, central bank, markets and research together without mixing similarly named indicators from other countries.", "每个看板将同一经济体的数据、央行、市场与研报放在一起，避免不同国家的同名指标混杂。")}</p>
      </div>
      <section className="ctiles" aria-label={tr(locale, "Featured economies", "重点经济体")}>
        {economies.map((economy, index) => (
          <Link className="ctile" href={localePath(locale, `/economies/${economy.slug}`)} key={economy.key}>
            <div className="a">{locale === "zh-CN" ? economy.nameZh : economy.nameEn}</div>
            <div className="ctile-meta">
              <span>{economy.code}</span>
              <span>{counts[index]}{tr(locale, " classified reports", " 篇已分类研报")}</span>
            </div>
          </Link>
        ))}
      </section>
      <p className="sub">{tr(locale, "The taxonomy already supports additional economies; a dashboard appears only when the product has enough structured data to show, rather than filling empty modules with guessed content.", "分类体系已支持更多经济体；只有在系统具备足够结构化数据后才扩展看板，不用推测内容填充空模块。")}</p>
    </main>
  );
}
