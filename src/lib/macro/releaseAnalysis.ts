import { prisma } from "../db";
import { resolveLLMProvider } from "../llm/config";
import type { LLMProvider } from "../llm/provider";
import { buildAnalysisContext } from "./analysis/context";
import { composeReleaseAnalysis, formatAnalysis } from "./analysis/compose";
import { toNumber, type FactInput, type FactSeriesPoint } from "./analysis/facts";
import { getPlaybook } from "./analysis/playbooks";

const UNSUPPORTED_EXPECTATION_CLAIM = /\b(?:beat|miss(?:ed)?|above|below|exceed(?:ed)?|disappoint(?:ed)?|in[- ]line with|matched?)\s+(?:the\s+)?(?:market\s+)?(?:consensus|expectations?)\b|(?:超出|超过|高于|低于|不及|逊于|符合|持平于)(?:市场)?预期|超预期|不及预期/iu;

export function analysisContainsUnsupportedExpectationClaim(text: string, hasSurveyConsensus: boolean) {
  return !hasSurveyConsensus && UNSUPPORTED_EXPECTATION_CLAIM.test(text);
}

/** Enough periods to place a change in its own distribution without loading the series. */
const HISTORY_PERIODS = 36;

/**
 * The series a read-out is read against, up to but excluding the period under review.
 *
 * One source per indicator — the enabled one with the most history — so a print captured
 * from a release-time file and its API twin do not appear as two different histories.
 */
async function indicatorHistory(canonicalKey: string, before: Date): Promise<FactSeriesPoint[]> {
  const sources = await prisma.macroSeriesSource.findMany({
    where: { enabled: true, indicator: { canonicalKey } },
    select: { id: true, priority: true },
    orderBy: { priority: "asc" },
  });
  for (const source of sources) {
    const rows = await prisma.macroObservation.findMany({
      where: { seriesSourceId: source.id, period: { lt: before } },
      orderBy: { period: "desc" },
      take: HISTORY_PERIODS,
      select: { period: true, value: true },
    });
    if (rows.length >= 6) return rows.map((row) => ({ period: row.period, value: Number(row.value.toString()) })).reverse();
  }
  return [];
}

/** The latest vintage for a period, to tell an untouched print from a revised one. */
async function latestForPeriod(canonicalKey: string, period: Date) {
  const row = await prisma.macroObservation.findFirst({
    where: { period, seriesSource: { enabled: true, indicator: { canonicalKey } } },
    orderBy: [{ vintageAt: "desc" }, { revisionNo: "desc" }],
    select: { value: true },
  });
  return row ? Number(row.value.toString()) : null;
}

/**
 * Generate and store the read-out for a released macro print.
 *
 * The work is split so that only the writing needs a model: the figures are computed from
 * stored history, the context is retrieved, and the draft is checked against those figures
 * before it is stored. A draft that cannot be made acceptable falls back to the arithmetic
 * itself rather than leaving the release without a read-out.
 */
export async function generateReleaseAnalysis(
  releaseId: string,
  injected?: LLMProvider | null,
): Promise<boolean> {
  const provider = injected ?? await resolveLLMProvider("release_analysis");
  if (!provider) throw new Error("No LLM provider is configured for release analysis.");
  const release = await prisma.macroRelease.findUnique({
    where: { id: releaseId },
    include: { values: { include: { indicator: true, modelExpectation: true } } },
  });
  if (!release) return false;
  const playbook = getPlaybook(release.releaseFamily, release.titleEn);
  const releasedAt = release.releasedAt ?? new Date();

  const values = await Promise.all(release.values.map(async (value) => {
    const period = value.observationPeriod;
    return {
      canonicalKey: value.indicator.canonicalKey,
      nameEn: value.indicator.nameEn,
      nameZh: value.indicator.nameZh,
      unit: value.indicator.unit,
      actual: toNumber(value.actualInitial)!,
      consensus: toNumber(value.consensusAtRelease),
      previous: toNumber(value.revisedPreviousAtRelease) ?? toNumber(value.previousAtRelease),
      initialActual: toNumber(value.actualInitial),
      latestActual: await latestForPeriod(value.indicator.canonicalKey, period),
    };
  }));
  if (!values.length || values.some((value) => value.actual === null)) return false;

  const history: Record<string, FactSeriesPoint[]> = {};
  for (const value of values) {
    history[value.canonicalKey] = await indicatorHistory(value.canonicalKey, release.scheduledAt);
  }

  const factInput: FactInput = {
    family: release.releaseFamily,
    title: release.titleEn,
    now: releasedAt,
    playbook,
    values: values as FactInput["values"],
    history,
  };
  const context = await buildAnalysisContext(release, playbook, releasedAt);
  const composed = await composeReleaseAnalysis({ provider, factInput, context, playbook });
  await prisma.macroRelease.update({
    where: { id: releaseId },
    data: {
      analysisEn: formatAnalysis(composed.en).slice(0, 8000),
      analysisZh: formatAnalysis(composed.zh).slice(0, 8000),
      analysisAt: new Date(),
    },
  });
  if (composed.fallback) {
    console.error(JSON.stringify({ event: "macro.release.analysis.fallback", releaseId, violations: composed.violations.slice(0, 6) }));
  } else if (composed.violations.length) {
    console.warn(JSON.stringify({ event: "macro.release.analysis.partial", releaseId, violations: composed.violations.slice(0, 6) }));
  }
  return true;
}

/**
 * Retry bookkeeping for read-out generation.
 *
 * The pending query below matches on "analysis is missing", which is exactly the state a
 * failing release stays in. Without a record of what has already been tried, every pass
 * re-bills the same failure for as long as the row exists — one release sat unanalysed for
 * six days and was retried on all 1,945 watcher passes. Attempts live in MacroSyncState
 * (already keyed by provider + scope, so no schema change) and gate the next try.
 */
const ANALYSIS_SCOPE = "release-analysis";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MACRO_RELEASE_ANALYSIS_MAX_ATTEMPTS || 3));
const BACKOFF_MS = Math.max(60_000, Number(process.env.MACRO_RELEASE_ANALYSIS_BACKOFF_MS || 15 * 60_000));

interface AnalysisState {
  scopeKey: string;
  lastStatus: string;
  lastAttemptAt: Date | null;
  metadata: string | null;
}

function attemptsOf(metadata: string | null): number {
  if (!metadata) return 0;
  try {
    const value = (JSON.parse(metadata) as { attempts?: unknown }).attempts;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Exponential: 15m, 30m, 1h … so a transient provider outage recovers without a hot loop. */
function nextAttemptAt(state: AnalysisState | undefined): number {
  const attempts = attemptsOf(state?.metadata ?? null);
  if (!state?.lastAttemptAt || attempts === 0) return 0;
  return state.lastAttemptAt.getTime() + BACKOFF_MS * 2 ** (attempts - 1);
}

function isDue(state: AnalysisState | undefined, now: Date): boolean {
  if (!state) return true;
  // "exhausted" is terminal on purpose: an operator reruns it with `macro:forecasts` once
  // the underlying problem is fixed, rather than the scheduler paying for it indefinitely.
  if (state.lastStatus === "exhausted") return false;
  return nextAttemptAt(state) <= now.getTime();
}

async function recordAttempt(releaseId: string, attempts: number, error: string | null) {
  const now = new Date();
  const status = error === null ? "succeeded" : attempts >= MAX_ATTEMPTS ? "exhausted" : "error";
  // A success resets the counter so a later re-generation starts from a clean slate.
  const metadata = JSON.stringify({ attempts: error === null ? 0 : attempts });
  await prisma.macroSyncState.upsert({
    where: { provider_scopeKey: { provider: ANALYSIS_SCOPE, scopeKey: releaseId } },
    create: {
      provider: ANALYSIS_SCOPE,
      scopeKey: releaseId,
      lastAttemptAt: now,
      lastSuccessAt: error === null ? now : null,
      lastStatus: status,
      lastError: error,
      metadata,
    },
    update: {
      lastAttemptAt: now,
      lastStatus: status,
      lastError: error,
      metadata,
      ...(error === null ? { lastSuccessAt: now } : {}),
    },
  });
  if (status === "exhausted") {
    console.error(JSON.stringify({ event: "macro.release.analysis.exhausted", releaseId, attempts, error }));
  }
}

/**
 * Generate newest-first so a just-published release is visible before old repairs.
 * Releases still inside their backoff window, or past MAX_ATTEMPTS, are skipped.
 */
export async function generatePendingReleaseAnalyses(limit = 5, now = new Date()): Promise<number> {
  const provider = await resolveLLMProvider("release_analysis");
  if (!provider) return 0;
  const pending = await prisma.macroRelease.findMany({
    where: {
      status: "RELEASED",
      values: { some: {} },
      OR: [{ analysisAt: null }, { analysisEn: null }, { analysisZh: null }],
    },
    orderBy: { releasedAt: "desc" },
    // Headroom, because backoff filters below the database can only filter above it.
    take: limit * 4,
    select: { id: true },
  });
  if (!pending.length) return 0;
  const states = await prisma.macroSyncState.findMany({
    where: { provider: ANALYSIS_SCOPE, scopeKey: { in: pending.map((release) => release.id) } },
    select: { scopeKey: true, lastStatus: true, lastAttemptAt: true, metadata: true },
  });
  const byRelease = new Map(states.map((state) => [state.scopeKey, state]));
  const due = pending.filter((release) => isDue(byRelease.get(release.id), now)).slice(0, limit);

  let generated = 0;
  for (const release of due) {
    const attempts = attemptsOf(byRelease.get(release.id)?.metadata ?? null) + 1;
    try {
      if (await generateReleaseAnalysis(release.id, provider)) {
        generated++;
        await recordAttempt(release.id, attempts, null);
      } else {
        await recordAttempt(release.id, attempts, "The read-out could not be generated from the captured values.");
      }
    } catch (error) {
      // Keep official-data polling alive; backoff decides when this item is selected again.
      await recordAttempt(release.id, attempts, String(error).slice(0, 500));
      console.error(JSON.stringify({ event: "macro.release.analysis.failed", releaseId: release.id, attempts, error: String(error).slice(0, 500) }));
    }
  }
  return generated;
}
