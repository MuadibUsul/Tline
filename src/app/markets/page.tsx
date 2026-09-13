import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { assetName, domainTerm, getLocale, localePath, tr } from "@/lib/i18n";
import { assetPath } from "@/lib/assetPath";
import { canonical } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: tr(locale, "Institutional Market Outlooks", "资产机构展望"),
    description: tr(locale, "Explore assets with source-linked institutional research and sufficient cross-institution coverage.", "浏览具有可核验机构研报和足够跨机构覆盖的资产观点。"),
    ...canonical("/markets", locale),
  };
}

export default async function MarketsPage() {
  const locale = await getLocale();
  const assets = await prisma.asset.findMany({
    where: { articleAssets: { some: { article: publicationReadyWhere() } } },
    orderBy: { name: "asc" },
    select: {
      ticker: true, name: true, assetClass: true,
      articleAssets: { where: { article: publicationReadyWhere() }, select: { article: { select: { institutionId: true, publishedAt: true } } } },
    },
  });
  const qualified = assets.map((asset) => ({
    ...asset,
    reports: asset.articleAssets.length,
    institutions: new Set(asset.articleAssets.map((item) => item.article.institutionId)).size,
    updatedAt: asset.articleAssets.reduce<Date | null>((latest, item) => !latest || item.article.publishedAt > latest ? item.article.publishedAt : latest, null),
  })).filter((asset) => asset.reports >= 2 && asset.institutions >= 2);

  return <main className="wrap">
    <div className="page-head"><div className="eyebrow">{tr(locale, "Institutional coverage", "机构覆盖")}</div><h1>{tr(locale, "Markets", "资产市场")}</h1><p className="sub">{tr(locale, "Only assets supported by multiple source-linked institutional reports are listed.", "仅展示由多家机构公开研报支持的资产页面。")}</p></div>
    <section className="ctiles" aria-label={tr(locale, "Covered markets", "已覆盖资产")}>
      {qualified.map((asset) => <Link className="ctile" href={localePath(locale, assetPath(asset.ticker))} key={asset.ticker}>
        <div className="a">{assetName(asset.name, locale, asset.ticker)}</div>
        <div className="s tnum">{asset.ticker}</div>
        <div className="meta"><span>{domainTerm(asset.assetClass, locale)}</span><span>{asset.institutions}{tr(locale, " institutions", "家机构")} · {asset.reports}{tr(locale, " reports", "篇研报")}</span></div>
      </Link>)}
    </section>
  </main>;
}
