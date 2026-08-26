import { prisma } from "./db";
import { computeConsensus, consensusChange, type ConsensusResult } from "./consensus";
import { ASSETS, directionLabel } from "./assets";

const FEATURED = ASSETS.filter((a) => a.featured).map((a) => a.ticker);

export interface ConsensusCard {
  ticker: string;
  name: string;
  score: number;
  label: string;
  tone: "bull" | "bear" | "neu";
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export async function featuredConsensus(): Promise<ConsensusCard[]> {
  const assets = await prisma.asset.findMany({ where: { ticker: { in: FEATURED } } });
  const order = new Map(FEATURED.map((t, i) => [t, i]));
  const cards: ConsensusCard[] = [];
  for (const a of assets) {
    const c = await computeConsensus(a.id);
    if (!c) continue;
    cards.push({
      ticker: a.ticker,
      name: a.name,
      score: c.score,
      label: c.label,
      tone: c.tone,
      d1: await consensusChange(a.id, 1),
      d7: await consensusChange(a.id, 7),
      d30: await consensusChange(a.id, 30),
    });
  }
  cards.sort((x, y) => (order.get(x.ticker)! - order.get(y.ticker)!));
  return cards;
}

export async function latestFeed(limit = 8) {
  return prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      institution: true,
      analysis: true,
      articleAssets: { include: { asset: true } },
    },
  });
}

export async function mostActive(days = 7, limit = 6) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.article.groupBy({
    by: ["institutionId"],
    where: { publishedAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { institutionId: "desc" } },
    take: limit,
  });
  const insts = await prisma.institution.findMany({
    where: { id: { in: rows.map((r) => r.institutionId) } },
  });
  const map = new Map(insts.map((i) => [i.id, i]));
  return rows.map((r) => ({ inst: map.get(r.institutionId)!, count: r._count._all }));
}

export async function viewChanges(limit = 6) {
  const assets = await prisma.asset.findMany();
  const out: { ticker: string; name: string; change: number }[] = [];
  for (const a of assets) {
    const ch = await consensusChange(a.id, 1);
    if (ch !== null && ch !== 0) out.push({ ticker: a.ticker, name: a.name, change: ch });
  }
  out.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
  return out.slice(0, limit);
}

export async function getAssetView(ticker: string) {
  const asset = await prisma.asset.findUnique({ where: { ticker: ticker.toUpperCase() } });
  if (!asset) return null;
  const c = await computeConsensus(asset.id);
  const d1 = await consensusChange(asset.id, 1);
  const d7 = await consensusChange(asset.id, 7);
  const d30 = await consensusChange(asset.id, 30);
  const targets = (c?.contributors ?? []).map((x) => x.target).filter((t): t is number => t != null);
  targets.sort((a, b) => a - b);
  const dist = targets.length
    ? {
        low: targets[0],
        high: targets[targets.length - 1],
        median: targets[Math.floor(targets.length / 2)],
        avg: Math.round(targets.reduce((s, t) => s + t, 0) / targets.length),
      }
    : null;
  const articles = await prisma.article.findMany({
    where: { articleAssets: { some: { assetId: asset.id } } },
    orderBy: { publishedAt: "desc" },
    take: 8,
    include: { institution: true, analysis: true, articleAssets: { include: { asset: true } } },
  });
  return { asset, consensus: c, d1, d7, d30, dist, articles };
}

export interface InstTimeline {
  institution: string;
  slug: string;
  targetChain: number[]; // e.g. [4600, 4800, 5000]
  dirChain: { direction: number; label: string; tone: "bull" | "bear" | "neu"; when: Date }[];
  latestTone: "bull" | "bear" | "neu";
  lastChange: Date;
  hasTargetMove: boolean;
  hasDirFlip: boolean;
}

/** Per-institution target + direction evolution for one asset, changed sources first. */
export async function getAssetTimeline(assetId: string): Promise<InstTimeline[]> {
  const rows = await prisma.articleAsset.findMany({
    where: { assetId },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "asc" } },
  });
  const byInst = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.article.institutionId;
    (byInst.get(k) ?? byInst.set(k, []).get(k)!).push(r);
  }

  const out: InstTimeline[] = [];
  for (const list of byInst.values()) {
    const targets: number[] = [];
    for (const r of list) {
      if (r.previousTarget != null && targets.length === 0) targets.push(r.previousTarget);
      if (r.target != null) targets.push(r.target);
    }
    // de-dup consecutive equal targets
    const targetChain = targets.filter((t, i) => i === 0 || t !== targets[i - 1]);

    const dirRaw = list.map((r) => ({ ...directionLabel(r.direction), direction: r.direction, when: r.article.publishedAt }));
    const dirChain = dirRaw.filter((d, i) => i === 0 || d.direction !== dirRaw[i - 1].direction);

    const last = list[list.length - 1];
    out.push({
      institution: last.article.institution.name,
      slug: last.article.institution.slug,
      targetChain,
      dirChain,
      latestTone: directionLabel(last.direction).tone,
      lastChange: last.article.publishedAt,
      hasTargetMove: targetChain.length > 1,
      hasDirFlip: dirChain.length > 1,
    });
  }
  out.sort((a, b) => b.lastChange.getTime() - a.lastChange.getTime());
  return out;
}

export async function getInstitutionView(slug: string) {
  const inst = await prisma.institution.findUnique({ where: { slug } });
  if (!inst) return null;
  const since = new Date(Date.now() - 90 * 864e5);
  const articles = await prisma.article.findMany({
    where: { institutionId: inst.id, publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    include: { analysis: true, articleAssets: { include: { asset: true } } },
  });
  // Current views = latest direction per asset.
  const views = new Map<string, { ticker: string; name: string; direction: number; target: number | null; when: Date }>();
  for (const art of articles) {
    for (const aa of art.articleAssets) {
      if (!views.has(aa.asset.ticker)) {
        views.set(aa.asset.ticker, {
          ticker: aa.asset.ticker,
          name: aa.asset.name,
          direction: aa.direction,
          target: aa.target,
          when: art.publishedAt,
        });
      }
    }
  }
  const coverage = [...new Set(articles.flatMap((a) => a.articleAssets.map((x) => x.asset.assetClass)))];
  return {
    inst,
    articles,
    count30: articles.filter((a) => a.publishedAt > new Date(Date.now() - 30 * 864e5)).length,
    views: [...views.values()].map((v) => ({ ...v, ...directionLabel(v.direction) })),
    coverage,
  };
}

export async function getResearchView(id: string) {
  return prisma.article.findUnique({
    where: { id },
    include: {
      institution: true,
      analysis: true,
      articleAssets: { include: { asset: true } },
      documents: { where: { status: "ready" }, orderBy: { createdAt: "asc" } },
      translations: { where: { locale: "zh-CN" }, take: 1 },
    },
  });
}

export type { ConsensusResult };
