import { prisma } from "../../db";
import { getMarketMovesForUse } from "../market/read";
import { getReleaseConsensus } from "../releaseConsensus";
import { getMacroIndicator, getMacroReleaseFamily } from "../registry";
import type { Playbook } from "./facts";
import type { MacroRelease } from "@prisma/client";

/**
 * What the print is read against.
 *
 * A number on its own is a fact; a number beside the last three surprises, what banks had
 * forecast, how the market moved afterwards and what the previous statement said is an
 * analysis. Every piece here is retrieved and quoted, never generated, so the read-out can
 * be specific about the present rather than generic about the concept.
 */
export interface AnalysisContext {
  /** The last few prints of this family: actual against the consensus that was frozen for each. */
  recentSurprises: Array<{ period: string; actual: string; consensus: string | null; verdict: string }>;
  hitRate: string | null;
  /** Forecasts mined from institution research for this release, if any were. */
  institutionForecasts: { median: number | null; range: { min: number | null; max: number | null }; count: number; contributors: string[] } | null;
  /** How markets actually moved after the print. Sampled, so the window is stated. */
  marketReaction: Array<{ symbol: string; changePct: number }>;
  marketWindowMinutes: number | null;
  /** For policy decisions: how the language changed from the previous statement. */
  policyDelta: { previousMeeting: string | null; changes: string[] } | null;
  /** Related series the playbook asks for, at their latest published values. */
  related: Array<{ canonicalKey: string; nameEn: string; value: string; period: string }>;
}

const MAX_MARKET_WINDOW_MINUTES = 90;

async function marketReaction(releasedAt: Date, symbols: string[]) {
  // Markets move in the minutes after a print, and the sampler runs every half hour, so the
  // window is taken as it is and its length reported rather than implied.
  const observation = await prisma.marketObservation.findFirst({ where: { observedAt: { lte: releasedAt } }, orderBy: { observedAt: "desc" }, select: { observedAt: true } });
  const since = observation?.observedAt ?? releasedAt;
  const now = new Date();
  const moves = await getMarketMovesForUse(since, now, "internal_analysis").catch(() => []);
  const wanted = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const windowMinutes = Math.round((now.getTime() - since.getTime()) / 60_000);
  if (windowMinutes > MAX_MARKET_WINDOW_MINUTES) return { moves: [], windowMinutes: null };
  return { moves: moves.filter((move) => wanted.size === 0 || wanted.has(move.symbol)), windowMinutes };
}

async function relatedSeries(keys: string[], exclude: string[]) {
  const rows: AnalysisContext["related"] = [];
  for (const canonicalKey of keys) {
    if (exclude.includes(canonicalKey)) continue;
    const indicator = getMacroIndicator(canonicalKey);
    if (!indicator) continue;
    const latest = await prisma.macroObservation.findFirst({
      where: { seriesSource: { enabled: true, indicator: { canonicalKey } } },
      orderBy: [{ period: "desc" }, { vintageAt: "desc" }],
      select: { value: true, period: true },
    });
    if (!latest) continue;
    rows.push({ canonicalKey, nameEn: indicator.nameEn, value: latest.value.toString(), period: latest.period.toISOString().slice(0, 10) });
  }
  return rows;
}

async function policyDelta(release: MacroRelease) {
  if (release.releaseFamily !== "FOMC_DECISION") return null;
  const documents = await prisma.macroPolicyDocument.findMany({
    where: { centralBank: "FED", docType: { in: ["STATEMENT", "IMPLEMENTATION_NOTE"] }, parsedJson: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: 4,
    select: { publishedAt: true, parsedJson: true, sourceUrl: true },
  });
  const statements = documents.filter((document) => {
    try { return (JSON.parse(document.parsedJson!) as { decision?: string }).decision !== undefined; } catch { return false; }
  });
  const current = statements.find((document) => Math.abs(document.publishedAt.getTime() - release.scheduledAt.getTime()) < 6 * 3600_000);
  const previous = statements.find((document) => document !== current && document.publishedAt < release.scheduledAt);
  if (!current || !previous) return null;
  const parse = (json: string) => JSON.parse(json) as Record<string, unknown>;
  const now = parse(current.parsedJson!);
  const before = parse(previous.parsedJson!);
  const changes: string[] = [];
  for (const field of ["decision", "stance", "inflationAssessment", "growthAssessment", "laborAssessment", "forwardGuidance", "balanceSheetAction"] as const) {
    const from = before[field];
    const to = now[field];
    if (typeof to === "string" && to && to !== from) changes.push(`${field}: ${to}`);
  }
  if (changes.length === 0) return { previousMeeting: previous.publishedAt.toISOString().slice(0, 10), changes: [] };
  return { previousMeeting: previous.publishedAt.toISOString().slice(0, 10), changes };
}

async function surpriseHistory(release: MacroRelease) {
  const family = getMacroReleaseFamily(release.releaseFamily);
  const primary = family?.indicators[0];
  if (!primary) return { recentSurprises: [], hitRate: null };
  const past = await prisma.macroRelease.findMany({
    where: { releaseFamily: release.releaseFamily, id: { not: release.id }, status: "RELEASED", releasedAt: { lt: release.scheduledAt } },
    orderBy: { releasedAt: "desc" },
    take: 4,
    include: { values: { where: { indicator: { canonicalKey: primary } }, select: { actualInitial: true, consensusAtRelease: true, observationPeriod: true } } },
  });
  const rows: AnalysisContext["recentSurprises"] = [];
  for (const item of past) {
    for (const value of item.values) {
      const actualNumber = value.actualInitial === null ? null : Number(value.actualInitial.toString());
      if (actualNumber === null) continue;
      const consensusNumber = value.consensusAtRelease === null ? null : Number(value.consensusAtRelease.toString());
      const period = value.observationPeriod.toISOString().slice(0, 10);
      if (consensusNumber === null) {
        rows.push({ period, actual: String(actualNumber), consensus: null, verdict: "no consensus recorded" });
        continue;
      }
      const verdict = actualNumber === consensusNumber ? "in line" : actualNumber > consensusNumber ? "above consensus" : "below consensus";
      rows.push({ period, actual: String(actualNumber), consensus: String(consensusNumber), verdict });
    }
  }
  const judged = rows.filter((row) => row.consensus !== null);
  const above = judged.filter((row) => row.verdict === "above consensus").length;
  const hitRate = judged.length ? `printed above the consensus in ${above} of the last ${judged.length} releases` : null;
  return { recentSurprises: rows, hitRate };
}

export async function buildAnalysisContext(release: MacroRelease, playbook: Playbook, releasedAt: Date): Promise<AnalysisContext> {
  const [surprises, consensus, reaction, related, policy] = await Promise.all([
    surpriseHistory(release),
    getReleaseConsensus(release).catch(() => null),
    marketReaction(releasedAt, playbook.market),
    relatedSeries(playbook.compare, []),
    policyDelta(release),
  ]);
  return {
    recentSurprises: surprises.recentSurprises,
    hitRate: surprises.hitRate,
    institutionForecasts: consensus ? { median: consensus.median, range: { min: consensus.min, max: consensus.max }, count: consensus.count, contributors: consensus.contributors.slice(0, 8).map((item) => item.institution) } : null,
    marketReaction: reaction.moves.map((move) => ({ symbol: move.symbol, changePct: Number(move.changePct.toFixed(2)) })),
    marketWindowMinutes: reaction.windowMinutes,
    policyDelta: policy,
    related,
  };
}
