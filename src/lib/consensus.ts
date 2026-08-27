import { prisma } from "./db";
import { directionLabel } from "./assets";

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
}

/** Compute the current institutional consensus for one asset. */
export async function computeConsensus(assetId: string): Promise<ConsensusResult | null> {
  const now = new Date();
  const since = consensusSince(now);
  const rows = await prisma.articleAsset.findMany({
    where: { assetId, article: { publishedAt: { gte: since, lte: now } } },
    include: { article: { include: { institution: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  if (rows.length === 0) return null;

  // Keep only the most recent view per institution.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.article.institutionId;
    if (!latest.has(key)) latest.set(key, r);
  }

  let num = 0;
  let den = 0;
  let bull = 0;
  let neu = 0;
  let bear = 0;
  const contributors: Contributor[] = [];

  for (const r of latest.values()) {
    const ageDays = (now.getTime() - r.article.publishedAt.getTime()) / 864e5;
    const w = r.article.institution.authorityScore;
    const d = decayFor(ageDays);
    num += w * d * r.direction;
    den += w * d;
    if (r.direction > 0) bull++;
    else if (r.direction < 0) bear++;
    else neu++;
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
  const score = Math.round(((raw + 2) / 4) * 100);
  const dl = directionLabel(raw);

  contributors.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return {
    score,
    raw: Number(raw.toFixed(3)),
    label: dl.label,
    tone: dl.tone,
    institutionCount: latest.size,
    bullishCount: bull,
    neutralCount: neu,
    bearishCount: bear,
    contributors,
  };
}

/** Recompute every asset and write a snapshot row (drives trend + alerts). */
export async function snapshotAll(): Promise<number> {
  const assets = await prisma.asset.findMany();
  let written = 0;
  for (const a of assets) {
    const c = await computeConsensus(a.id);
    if (!c) continue;
    await prisma.consensusHistory.create({
      data: {
        assetId: a.id,
        consensusScore: c.score,
        institutionCount: c.institutionCount,
        bullishCount: c.bullishCount,
        neutralCount: c.neutralCount,
        bearishCount: c.bearishCount,
      },
    });
    written++;
  }
  return written;
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
