import type { Metadata } from "next";
import { canonical, ogImage } from "@/lib/seo";
import Link from "next/link";
import { ResearchCard } from "@/app/_components/ui";
import LiveFeed from "@/app/_components/LiveFeed";
import { prisma } from "@/lib/db";
import { assetName, getLocale, institutionName, tr, localePath } from "@/lib/i18n";
import { publicationReadyWhere } from "@/lib/publication";
import { byDisplayRecency, feedPulse } from "@/lib/queries";
import { paginationWindow } from "@/lib/pagination";

export const dynamic = "force-dynamic";

type ResearchSearchParams = { institution?: string; country?: string; category?: string; ticker?: string; direction?: string; page?: string; q?: string };

export async function generateMetadata(props: { searchParams: Promise<ResearchSearchParams> }): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const filtered = Object.entries(searchParams).some(([key, value]) => key !== "page" && Boolean(value));
  const emptyPage = !filtered && page > 1 && (page - 1) * 20 >= await prisma.article.count({ where: publicationReadyWhere() });
  const title = tr(locale, "Verified Institutional Research & Structured Views", "已验证机构研报与结构化观点");
  const description = tr(locale, "Source-linked public research with comparable asset views, horizons, risks and institutional context.", "带原始来源的公开研报，包含可比较的资产观点、期限、风险与机构上下文。");
  return { ...canonical(!filtered && page > 1 ? `/research?page=${page}` : "/research", locale), ...(filtered || emptyPage ? { robots: { index: false, follow: true } } : {}), title, description, openGraph: { images: [{ url: ogImage("Research", "Verified Institutional Research", "Sources, horizons, risks and comparable views"), width: 1200, height: 630 }] } };
}

const ASSET_CLASSES: Array<[string, string]> = [["equity", "股票"], ["rate", "利率"], ["fx", "外汇"], ["commodity", "大宗商品"], ["crypto", "加密资产"], ["macro", "宏观"]];

export default async function ResearchIndex(
  props: {
    searchParams: Promise<ResearchSearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const take = 20;
  const direction = searchParams.direction === "bull"
    ? { gt: 0 }
    : searchParams.direction === "bear"
      ? { lt: 0 }
      : searchParams.direction === "neutral"
        ? { equals: 0 }
        : undefined;
  const asset = {
    ...(searchParams.ticker ? { ticker: searchParams.ticker } : {}),
    ...(searchParams.category ? { assetClass: searchParams.category } : {}),
  };
  const hasAssetFilter = searchParams.ticker || searchParams.category || direction;
  const where = publicationReadyWhere({
    ...((searchParams.institution || searchParams.country) ? {
      institution: {
        ...(searchParams.institution ? { slug: searchParams.institution } : {}),
        ...(searchParams.country ? { country: searchParams.country } : {}),
      },
    } : {}),
    ...(hasAssetFilter ? {
      articleAssets: {
        some: {
          ...(Object.keys(asset).length ? { asset } : {}),
          ...(direction ? { direction } : {}),
        },
      },
    } : {}),
  });
  const [articles, institutions, assets, countries, pulse] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { id: "desc" },
      select: { id: true, publishedAt: true, createdAt: true },
    }),
    prisma.institution.findMany({ where: { articles: { some: publicationReadyWhere() } }, orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    prisma.asset.findMany({ where: { articleAssets: { some: { article: publicationReadyWhere() } } }, orderBy: { name: "asc" }, select: { ticker: true, name: true } }),
    prisma.institution.findMany({ where: { country: { not: null }, articles: { some: publicationReadyWhere() } }, orderBy: { country: "asc" }, distinct: ["country"], select: { country: true } }),
    feedPulse(),
  ]);
  const total = articles.length;
  const pageIds = articles.sort(byDisplayRecency).slice((page - 1) * take, page * take).map(({ id }) => id);
  const feed = (await prisma.article.findMany({
    where: { ...where, id: { in: pageIds } },
    include: { institution: true, analysis: true, translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } }, articleAssets: { include: { asset: true } } },
  })).sort(byDisplayRecency);
  const pages = Math.max(1, Math.ceil(total / take));
  const query = new URLSearchParams();
  if (searchParams.institution) query.set("institution", searchParams.institution);
  if (searchParams.country) query.set("country", searchParams.country);
  if (searchParams.category) query.set("category", searchParams.category);
  if (searchParams.ticker) query.set("ticker", searchParams.ticker);
  if (searchParams.direction) query.set("direction", searchParams.direction);
  const pageHref = (target: number) => {
    const params = new URLSearchParams(query);
    params.set("page", String(target));
    return localePath(locale, `/research?${params.toString()}`);
  };

  return (
    <main className="wrap">
      <LiveFeed
        initial={pulse}
        label={tr(locale, "New research", "有新研报")}
        ariaLabel={tr(locale, "Load newly published research", "载入新发布的研报")}
      />
      <div className="page-head"><div className="eyebrow">{tr(locale, "Feed", "研报流")}</div><h1>{tr(locale, "Latest Research", "最新研报")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, `${total} structured institutional reports.`, `共 ${total} 篇结构化机构研报。`)}</p>
      </div>
      <section style={{ paddingTop: 22 }}>
        <form className="research-filters">
          {countries.length > 0 && (
            <select name="country" defaultValue={searchParams.country ?? ""} aria-label={tr(locale, "Country", "国家")}>
              <option value="">{tr(locale, "All countries", "全部国家")}</option>
              {countries.map(({ country }) => <option key={country!} value={country!}>{country}</option>)}
            </select>
          )}
          <select name="institution" defaultValue={searchParams.institution ?? ""} aria-label={tr(locale, "Institution", "投行")}>
            <option value="">{tr(locale, "All institutions", "全部投行")}</option>
            {institutions.map((institution) => <option key={institution.slug} value={institution.slug}>{institutionName(institution.name, locale)}</option>)}
          </select>
          <select name="category" defaultValue={searchParams.category ?? ""} aria-label={tr(locale, "Category", "类别")}>
            <option value="">{tr(locale, "All categories", "全部类别")}</option>
            {ASSET_CLASSES.map(([value, zh]) => <option key={value} value={value}>{locale === "zh-CN" ? zh : value}</option>)}
          </select>
          <select name="ticker" defaultValue={searchParams.ticker ?? ""} aria-label={tr(locale, "Asset", "资产")}>
            <option value="">{tr(locale, "All assets", "全部资产")}</option>
            {assets.map((asset) => <option key={asset.ticker} value={asset.ticker}>{assetName(asset.name, locale, asset.ticker)} · {asset.ticker}</option>)}
          </select>
          <select name="direction" defaultValue={searchParams.direction ?? ""} aria-label={tr(locale, "Direction", "方向")}>
            <option value="">{tr(locale, "All asset-view directions", "全部资产观点方向")}</option>
            <option value="bull">{tr(locale, "Bullish asset views", "看多的资产观点")}</option>
            <option value="neutral">{tr(locale, "Neutral asset views", "中性的资产观点")}</option>
            <option value="bear">{tr(locale, "Bearish asset views", "看空的资产观点")}</option>
          </select>
          <button className="minibtn p" type="submit">{tr(locale, "Apply filters", "应用筛选")}</button>
        </form>
        {feed.length ? <div className="research-grid">{feed.map((article) => <ResearchCard key={article.id} a={article} locale={locale} />)}</div> : <div className="empty-state">{tr(locale, "No research matches these filters.", "没有符合筛选条件的研报。")}</div>}
        {pages > 1 && (
          <nav className="pagination" aria-label={tr(locale, "Research pages", "研报分页")}>
            {page > 1
              ? <Link href={pageHref(page - 1)} rel="prev">← {tr(locale, "Previous", "上一页")}</Link>
              : <span />}
            {/* Numbered jumps, not just neighbours: the older half of the corpus was two
                hundred Next clicks deep, which is far enough to be unreachable in practice. */}
            <span className="pagination-pages">
              {paginationWindow(page, pages).map((target, position) => (target === null
                ? <span key={`gap-${position}`} className="pagination-gap">…</span>
                : target === page
                  ? <span key={target} aria-current="page" className="pagination-here">{target}</span>
                  : <Link key={target} href={pageHref(target)}>{target}</Link>))}
            </span>
            {page < pages
              ? <Link href={pageHref(page + 1)} rel="next">{tr(locale, "Next", "下一页")} →</Link>
              : <span />}
          </nav>
        )}
      </section>
    </main>
  );
}
