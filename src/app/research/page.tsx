import Link from "next/link";
import { FeedCard } from "@/app/_components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ResearchIndex({
  searchParams,
}: {
  searchParams: { institution?: string; ticker?: string; direction?: string; page?: string };
}) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const take = 20;
  const direction = searchParams.direction === "bull"
    ? { gt: 0 }
    : searchParams.direction === "bear"
      ? { lt: 0 }
      : searchParams.direction === "neutral"
        ? { equals: 0 }
        : undefined;
  const where = {
    ...(searchParams.institution ? { institution: { slug: searchParams.institution } } : {}),
    ...((searchParams.ticker || direction) ? {
      articleAssets: {
        some: {
          ...(searchParams.ticker ? { asset: { ticker: searchParams.ticker } } : {}),
          ...(direction ? { direction } : {}),
        },
      },
    } : {}),
  };
  const [feed, total, institutions, assets] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: { institution: true, analysis: true, articleAssets: { include: { asset: true } } },
    }),
    prisma.article.count({ where }),
    prisma.institution.findMany({ where: { articles: { some: {} } }, orderBy: { name: "asc" }, select: { slug: true, name: true } }),
    prisma.asset.findMany({ where: { articleAssets: { some: {} } }, orderBy: { name: "asc" }, select: { ticker: true, name: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / take));
  const query = new URLSearchParams();
  if (searchParams.institution) query.set("institution", searchParams.institution);
  if (searchParams.ticker) query.set("ticker", searchParams.ticker);
  if (searchParams.direction) query.set("direction", searchParams.direction);

  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">Feed</div><h1>Latest Research</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>{total} structured institutional reports.</p>
      </div>
      <section style={{ paddingTop: 22, maxWidth: 820 }}>
        <form className="research-filters">
          <select name="institution" defaultValue={searchParams.institution ?? ""} aria-label="Institution">
            <option value="">All institutions</option>
            {institutions.map((institution) => <option key={institution.slug} value={institution.slug}>{institution.name}</option>)}
          </select>
          <select name="ticker" defaultValue={searchParams.ticker ?? ""} aria-label="Asset">
            <option value="">All assets</option>
            {assets.map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.name} · {asset.ticker}</option>)}
          </select>
          <select name="direction" defaultValue={searchParams.direction ?? ""} aria-label="Direction">
            <option value="">All directions</option>
            <option value="bull">Bullish</option>
            <option value="neutral">Neutral</option>
            <option value="bear">Bearish</option>
          </select>
          <button className="minibtn p" type="submit">Apply filters</button>
        </form>
        {feed.length ? <div className="feed">{feed.map((article) => <FeedCard key={article.id} a={article} />)}</div> : <div className="empty-state">No research matches these filters.</div>}
        {pages > 1 && (
          <nav className="pagination" aria-label="Research pages">
            {page > 1 && <Link href={`/research?${query.toString()}&page=${page - 1}`}>← Previous</Link>}
            <span>Page {page} / {pages}</span>
            {page < pages && <Link href={`/research?${query.toString()}&page=${page + 1}`}>Next →</Link>}
          </nav>
        )}
      </section>
    </main>
  );
}
