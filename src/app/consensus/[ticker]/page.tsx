import Link from "next/link";
import { notFound } from "next/navigation";
import { computeConsensus } from "@/lib/consensus";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function TrendChart({ points, ticker }: { points: { timestamp: Date; consensusScore: number }[]; ticker: string }) {
  const width = 900;
  const height = 280;
  const pad = 34;
  const minTime = points[0]?.timestamp.getTime() ?? 0;
  const maxTime = points.at(-1)?.timestamp.getTime() ?? minTime + 1;
  const x = (date: Date) => pad + ((date.getTime() - minTime) / Math.max(1, maxTime - minTime)) * (width - pad * 2);
  const y = (score: number) => pad + ((100 - score) / 100) * (height - pad * 2);
  const line = points.map((point) => `${x(point.timestamp).toFixed(1)},${y(point.consensusScore).toFixed(1)}`).join(" ");
  const tone = (points.at(-1)?.consensusScore ?? 50) >= 60 ? "var(--bull)" : (points.at(-1)?.consensusScore ?? 50) <= 40 ? "var(--bear)" : "var(--neu)";

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="trend-title trend-desc">
        <title id="trend-title">{`${ticker} institutional consensus trend`}</title>
        <desc id="trend-desc">Consensus score from 0 to 100 across the selected period.</desc>
        {[0, 25, 50, 75, 100].map((score) => (
          <g key={score}>
            <line x1={pad} x2={width - pad} y1={y(score)} y2={y(score)} stroke="var(--border)" strokeDasharray={score === 50 ? "5 5" : undefined} />
            <text x={4} y={y(score) + 4} fill="var(--faint)" fontSize="11">{score}</text>
          </g>
        ))}
        {points.length > 1 && <polyline points={line} fill="none" stroke={tone} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((point, index) => (
          <circle key={point.timestamp.toISOString()} cx={x(point.timestamp)} cy={y(point.consensusScore)} r={index === points.length - 1 ? 5 : 3} fill={tone}>
            <title>{`${point.timestamp.toISOString().slice(0, 10)} · ${point.consensusScore}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export default async function ConsensusTrendPage({
  params,
  searchParams,
}: {
  params: { ticker: string };
  searchParams: { range?: string };
}) {
  const asset = await prisma.asset.findUnique({ where: { ticker: params.ticker.toUpperCase() } });
  if (!asset) notFound();
  const ranges: Record<string, number> = { "1m": 31, "3m": 93, "1y": 366 };
  const selected = searchParams.range && ranges[searchParams.range] ? searchParams.range : "1m";
  const since = new Date(Date.now() - ranges[selected] * 864e5);
  const points = await prisma.consensusHistory.findMany({
    where: { assetId: asset.id, timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
  });
  const current = await computeConsensus(asset.id);
  const first = points[0]?.consensusScore;
  const change = first === undefined || !current ? null : current.score - first;
  const articles = await prisma.article.findMany({
    where: { articleAssets: { some: { assetId: asset.id } } },
    orderBy: { publishedAt: "desc" },
    take: 6,
    include: { institution: true },
  });

  return (
    <main className="wrap">
      <div className="page-head">
        <div className="eyebrow">Consensus Index · {asset.ticker}</div>
        <div className="big-score">
          <h1>{asset.name}</h1>
          {current && <span className="num">{current.score}</span>}
        </div>
        <div className="deltas">
          <span>{selected.toUpperCase()} <b className={change && change > 0 ? "up" : change && change < 0 ? "down" : "flat"}>{change === null ? "—" : `${change > 0 ? "+" : ""}${change}`}</b></span>
          <span>{current?.institutionCount ?? 0} institutions</span>
        </div>
      </div>

      <section className="blk">
        <div className="range-tabs" aria-label="Trend range">
          {Object.keys(ranges).map((range) => <Link key={range} href={`/consensus/${asset.ticker}?range=${range}`} className={range === selected ? "active" : ""}>{range.toUpperCase()}</Link>)}
        </div>
        {points.length ? <TrendChart points={points} ticker={asset.ticker} /> : <div className="empty-state">No consensus history in this range yet.</div>}
      </section>

      <section style={{ paddingTop: 26 }}>
        <div className="section-t">Related Research</div>
        <div className="rowlist">
          {articles.map((article) => (
            <Link key={article.id} href={`/research/${article.id}`}>
              <span><b>{article.institution.name}</b> · {article.title}</span>
              <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>{article.publishedAt.toISOString().slice(0, 10)}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
