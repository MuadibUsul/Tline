import Link from "next/link";
import { ResearchCard } from "@/app/_components/ui";
import { prisma } from "@/lib/db";
import { assetName, getLocale, institutionName, tr } from "@/lib/i18n";
import { publicationReadyWhere } from "@/lib/publication";

export const dynamic = "force-dynamic";

export default async function ResearchIndex(
  props: {
    searchParams: Promise<{ institution?: string; ticker?: string; direction?: string; page?: string }>;
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
  const where = publicationReadyWhere({
    ...(searchParams.institution ? { institution: { slug: searchParams.institution } } : {}),
    ...((searchParams.ticker || direction) ? {
      articleAssets: {
        some: {
          ...(searchParams.ticker ? { asset: { ticker: searchParams.ticker } } : {}),
          ...(direction ? { direction } : {}),
        },
      },
    } : {}),
  });
  const [feed, total, institutions, assets] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: { institution: true, analysis: true, translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true, text: true } }, articleAssets: { include: { asset: true } } },
    }),
    prisma.article.count({ where }),
    prisma.institution.findMany({ where: { articles: { some: publicationReadyWhere() } }, orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    prisma.asset.findMany({ where: { articleAssets: { some: { article: publicationReadyWhere() } } }, orderBy: { name: "asc" }, select: { ticker: true, name: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / take));
  const query = new URLSearchParams();
  if (searchParams.institution) query.set("institution", searchParams.institution);
  if (searchParams.ticker) query.set("ticker", searchParams.ticker);
  if (searchParams.direction) query.set("direction", searchParams.direction);

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">{tr(locale, "Feed", "研报流")}</div><h1>{tr(locale, "Latest Research", "最新研报")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{tr(locale, `${total} structured institutional reports.`, `共 ${total} 篇结构化机构研报。`)}</p>
      </div>
      <section style={{ paddingTop: 22 }}>
        <form className="research-filters">
          <select name="institution" defaultValue={searchParams.institution ?? ""} aria-label={tr(locale, "Institution", "机构")}>
            <option value="">{tr(locale, "All institutions", "全部机构")}</option>
            {institutions.map((institution) => <option key={institution.slug} value={institution.slug}>{institutionName(institution.name, locale)}</option>)}
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
            {page > 1 && <Link href={`/research?${query.toString()}&page=${page - 1}`}>← {tr(locale, "Previous", "上一页")}</Link>}
            <span>{tr(locale, `Page ${page} / ${pages}`, `第 ${page} / ${pages} 页`)}</span>
            {page < pages && <Link href={`/research?${query.toString()}&page=${page + 1}`}>{tr(locale, "Next", "下一页")} →</Link>}
          </nav>
        )}
      </section>
    </main>
  );
}
