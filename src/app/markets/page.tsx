import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { assetName, domainTerm, getLocale, localePath, tr } from "@/lib/i18n";
import { assetPath } from "@/lib/assetPath";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, collectionPageJsonLd, itemListJsonLd, marketsSeoTitle, ogImage, localizedUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const description = tr(
    locale,
    "Every asset covered by at least two institutional publishers, with the current balance of opinion, each published target price, and the reports behind them.",
    "每个至少有 2 家机构公开覆盖的资产：当前多空分布、各机构公布的目标价，以及背后的原始研报。",
  );
  const title = clamp(marketsSeoTitle(locale), 60);
  return {
    title: { absolute: title },
    description: clamp(description, 158),
    ...canonical("/markets", locale),
    openGraph: { type: "website", title, description, url: localizedUrl("/markets", locale), locale, images: [{ url: ogImage("Markets", title, tr(locale, "Coverage, consensus and targets by asset", "按资产查看覆盖、共识与目标价")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
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
  const assetClasses = [...new Set(qualified.map((asset) => asset.assetClass))];
  const institutionTotal = new Set(qualified.flatMap((asset) => asset.articleAssets.map((item) => item.article.institutionId))).size;

  return <main className="wrap">
    <JsonLd data={collectionPageJsonLd(locale, "/markets", marketsSeoTitle(locale), tr(locale, "Assets with cross-institution coverage.", "具备跨机构覆盖的资产。"), tr(locale, "Financial markets", "金融市场"))} />
    <JsonLd data={itemListJsonLd(locale, "/markets", tr(locale, "Covered markets", "已覆盖资产"), qualified.map((asset) => ({ name: `${assetName(asset.name, locale, asset.ticker)} (${asset.ticker})`, path: assetPath(asset.ticker) })))} />
    <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "Markets", "资产市场"), path: "/markets" }])} />
    <div className="page-head"><div className="eyebrow">{tr(locale, "Institutional coverage", "机构覆盖")}</div><h1>{tr(locale, "Markets", "资产市场")}</h1><p className="sub">{tr(locale, "Only assets supported by multiple source-linked institutional reports are listed.", "仅展示由多家机构公开研报支持的资产页面。")}</p></div>
    <p className="sub" style={{ maxWidth: "72ch", color: "var(--muted)" }}>
      {tr(locale,
        `${qualified.length} assets are covered by ${institutionTotal} institutions across ${assetClasses.map((item) => domainTerm(item, locale)).join(", ")}. Each asset page shows the current balance of bullish and bearish views, every published target with its horizon, the changes recorded in the last 30 days, and the reports behind them.`,
        `${qualified.length} 个资产由 ${institutionTotal} 家机构覆盖，涵盖${assetClasses.map((item) => domainTerm(item, locale)).join("、")}。每个资产页展示当前多空分布、各机构公布的目标价与期限、过去 30 天记录到的观点变化，以及背后的原始研报。`)}
    </p>
    <h2 className="section-t">{tr(locale, "Covered markets", "已覆盖资产")}</h2>
    <section className="ctiles" aria-label={tr(locale, "Covered markets", "已覆盖资产")}>
      {qualified.map((asset) => <Link className="ctile" href={localePath(locale, assetPath(asset.ticker))} key={asset.ticker}>
        <div className="a">{assetName(asset.name, locale, asset.ticker)}</div>
        <div className="s tnum">{asset.ticker}</div>
        <div className="meta"><span>{domainTerm(asset.assetClass, locale)}</span><span>{asset.institutions}{tr(locale, " institutions", "家机构")} · {asset.reports}{tr(locale, " reports", "篇研报")}</span></div>
      </Link>)}
    </section>
  </main>;
}
