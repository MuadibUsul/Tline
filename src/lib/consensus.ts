import { prisma } from "./db";
import { directionLabel } from "./assets";
import { publicationReadyWhere } from "./publication";

export const CONSENSUS_WINDOW_HOURS = 24;
const TAU = 31;

export function consensusSince(now = new Date()): Date {
  return new Date(now.getTime() - CONSENSUS_WINDOW_HOURS * 36e5);
}

export function decayFor(ageDays: number): number {
  return Math.exp(-Math.max(0, ageDays) / TAU);
}

export interface Contributor {
  institutionId: string;
  institutionName: string;
  slug: string;
  direction: number;
  target: number | null;
  previousTarget: number | null;
  weight: number;
  decay: number;
  publishedAt: Date;
  timeHorizon: string | null;
}

export interface ConsensusResult {
  score: number; // 0..100
  raw: number; // -2..+2
  label: string;
  tone: "bull" | "bear" | "neu";
  institutionCount: number;
  bullishCount: number;
  neutralCount: number;
  bearishCount: number;
  contributors: Contributor[];
  isFallback: boolean;
  windowStart: Date;
  windowEnd: Date;
}

type ConsensusRow = {
  assetId: string;
  direction: number;
  target: number | null;
  previousTarget: number | null;
  timeHorizon: string | null;
  article: { publishedAt: Date; institutionId: string; institution: { name: string; slug: string; authorityScore: number } };
};

/** Pure authority-weighted, time-decayed aggregation of one asset's views in a window. */
function buildConsensus(rows: ConsensusRow[], windowStart: Date, windowEnd: Date, isFallback: boolean): ConsensusResult | null {
  if (rows.length === 0) return null;
  // Keep only the most recent view per institution (rows arrive newest-first).
  const latest = new Map<string, ConsensusRow>();
  for (const r of rows) if (!latest.has(r.article.institutionId)) latest.set(r.article.institutionId, r);

  let num = 0, den = 0, bull = 0, neu = 0, bear = 0;
  const contributors: Contributor[] = [];
  for (const r of latest.values()) {
    const ageDays = (windowEnd.getTime() - r.article.publishedAt.getTime()) / 864e5;
    const w = r.article.institution.authorityScore;
    const d = decayFor(ageDays);
    num += w * d * r.direction;
    den += w * d;
    if (r.direction > 0) bull++; else if (r.direction < 0) bear++; else neu++;
    contributors.push({
      institutionId: r.article.institutionId,
      institutionName: r.article.institution.name,
      slug: r.article.institution.slug,
      direction: r.direction,
      target: r.target,
      previousTarget: r.previousTarget,
      weight: w,
      decay: Number(d.toFixed(3)),
      publishedAt: r.article.publishedAt,
      timeHorizon: r.timeHorizon,
    });
  }
  const raw = den === 0 ? 0 : num / den;
  const dl = directionLabel(raw);
  contributors.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return {
    score: Math.round(((raw + 2) / 4) * 100),
    raw: Number(raw.toFixed(3)),
    label: dl.label,
    tone: dl.tone,
    institutionCount: latest.size,
    bullishCount: bull,
    neutralCount: neu,
    bearishCount: bear,
    contributors,
    isFallback,
    windowStart,
    windowEnd,
  };
}

/** Compute the current institutional consensus for one asset. */
export async function computeConsensus(
  assetId: string,
  { fallback = true, now = new Date() }: { fallback?: boolean; now?: Date } = {},
): Promise<ConsensusResult | null> {
  const windowStart = consensusSince(now);
  const rows = await prisma.articleAsset.findMany({
    where: { assetId, article: publicationReadyWhere({ publishedAt: { gte: windowStart, lte: now } }) },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  if (rows.length > 0) return buildConsensus(rows, windowStart, now, false);
  if (!fallback) return null;
  const latest = await prisma.articleAsset.findFirst({
    where: { assetId, article: publicationReadyWhere({ publishedAt: { lte: now } }) },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  if (!latest) return null;
  const windowEnd = latest.article.publishedAt;
  const fallbackStart = consensusSince(windowEnd);
  const fallbackRows = await prisma.articleAsset.findMany({
    where: { assetId, article: publicationReadyWhere({ publishedAt: { gte: fallbackStart, lte: windowEnd } }) },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  return buildConsensus(fallbackRows, fallbackStart, windowEnd, true);
}

/** Batch consensus for many assets in two queries instead of one-to-three per asset. */
export async function computeConsensusMany(
  assetIds: string[],
  { now = new Date() }: { now?: Date } = {},
): Promise<Map<string, ConsensusResult>> {
  const result = new Map<string, ConsensusResult>();
  if (assetIds.length === 0) return result;
  const windowStart = consensusSince(now);
  const inWindow = await prisma.articleAsset.findMany({
    where: { assetId: { in: assetIds }, article: publicationReadyWhere({ publishedAt: { gte: windowStart, lte: now } }) },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  const byAsset = new Map<string, ConsensusRow[]>();
  for (const r of inWindow) (byAsset.get(r.assetId) ?? byAsset.set(r.assetId, []).get(r.assetId)!).push(r);

  const missing: string[] = [];
  for (const id of assetIds) {
    const rows = byAsset.get(id);
    if (rows?.length) result.set(id, buildConsensus(rows, windowStart, now, false)!);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  // Fallback assets (no view in the live window): use each one's latest 24h window.
  const history = await prisma.articleAsset.findMany({
    where: { assetId: { in: missing }, article: publicationReadyWhere({ publishedAt: { lte: now } }) },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  const byMissing = new Map<string, ConsensusRow[]>();
  for (const r of history) (byMissing.get(r.assetId) ?? byMissing.set(r.assetId, []).get(r.assetId)!).push(r);
  for (const id of missing) {
    const rows = byMissing.get(id);
    if (!rows?.length) continue;
    const windowEnd = rows[0].article.publishedAt;
    const start = consensusSince(windowEnd);
    const consensus = buildConsensus(rows.filter((r) => r.article.publishedAt >= start), start, windowEnd, true);
    if (consensus) result.set(id, consensus);
  }
  return result;
}

/** Recompute every asset and write snapshot rows (drives trend + alerts). */
export async function snapshotAll(): Promise<number> {
  const assets = await prisma.asset.findMany();
  const consensus = await computeConsensusMany(assets.map((a) => a.id));
  const data = assets.flatMap((a) => {
    const c = consensus.get(a.id);
    return c && !c.isFallback
      ? [{ assetId: a.id, consensusScore: c.score, institutionCount: c.institutionCount, bullishCount: c.bullishCount, neutralCount: c.neutralCount, bearishCount: c.bearishCount }]
      : [];
  });
  if (data.length) await prisma.consensusHistory.createMany({ data });
  return data.length;
}

/** Change over N days from the snapshot history. */
export async function consensusChange(assetId: string, days: number): Promise<number | null> {
  const at = new Date(Date.now() - days * 864e5);
  const current = await prisma.consensusHistory.findFirst({
    where: { assetId },
    orderBy: { timestamp: "desc" },
  });
  if (!current) return null;
  const past = await prisma.consensusHistory.findFirst({
    where: { assetId, timestamp: { lte: at } },
    orderBy: { timestamp: "desc" },
  });
  if (!past) return null;
  return current.consensusScore - past.consensusScore;
}

/** Batch N-day consensus deltas for many assets in a single snapshot query. */
export async function consensusDeltas(assetIds: string[], dayList: number[]): Promise<Map<string, Record<number, number | null>>> {
  const result = new Map<string, Record<number, number | null>>();
  if (assetIds.length === 0) return result;
  const now = Date.now();
  const maxDays = Math.max(...dayList);
  const rows = await prisma.consensusHistory.findMany({
    where: { assetId: { in: assetIds }, timestamp: { gte: new Date(now - (maxDays + 2) * 864e5) } },
    orderBy: { timestamp: "desc" },
    select: { assetId: true, consensusScore: true, timestamp: true },
  });
  const byAsset = new Map<string, typeof rows>();
  for (const r of rows) (byAsset.get(r.assetId) ?? byAsset.set(r.assetId, []).get(r.assetId)!).push(r);
  for (const id of assetIds) {
    const snaps = byAsset.get(id); // newest-first
    const deltas: Record<number, number | null> = {};
    for (const days of dayList) {
      if (!snaps?.length) { deltas[days] = null; continue; }
      const past = snaps.find((s) => s.timestamp.getTime() <= now - days * 864e5);
      deltas[days] = past ? snaps[0].consensusScore - past.consensusScore : null;
    }
    result.set(id, deltas);
  }
  return result;
}
