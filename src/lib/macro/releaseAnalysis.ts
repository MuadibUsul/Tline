import { prisma } from "../db";
import { resolveLLMProvider } from "../llm/config";
import { completeJSON, type LLMProvider } from "../llm/provider";
import { getReleaseConsensus } from "./releaseConsensus";

const SYSTEM = `You are a macro strategist writing a concise professional read-out of an economic data release for institutional readers.
Given the release facts (actual, previous, and the consensus mined from bank research with its distribution), write 300–400 words of analysis in BOTH English and Simplified Chinese.
Cover: whether the print beat/missed/matched the institutional consensus and by how much; the change vs the previous period; what it implies for the trajectory; and how it sits against the range of bank forecasts. Be factual and restrained. Do not give investment advice or price targets.
Return ONLY JSON: {"en":string,"zh":string}.`;

/** Generate and store the AI read-out for a released macro print. Idempotent-ish: overwrites. */
export async function generateReleaseAnalysis(
  releaseId: string,
  injected?: LLMProvider | null,
): Promise<boolean> {
  const provider = injected ?? await resolveLLMProvider("release_analysis");
  if (!provider) throw new Error("No LLM provider is configured for release analysis.");
  const release = await prisma.macroRelease.findUnique({
    where: { id: releaseId },
    include: { values: { include: { indicator: true } } },
  });
  if (!release) return false;
  const value = release.values[0];
  const consensus = await getReleaseConsensus(release);
  const facts = {
    indicator: value?.indicator ? value.indicator.nameEn : release.titleEn,
    unit: value?.indicator?.unit ?? consensus?.unit ?? "",
    referencePeriod: value?.observationPeriod?.toISOString().slice(0, 10) ?? null,
    actual: value?.actualInitial != null ? Number(value.actualInitial.toString()) : null,
    previous: value ? Number((value.revisedPreviousAtRelease ?? value.previousAtRelease)?.toString() ?? "") || null : null,
    institutionalConsensus: consensus?.median ?? null,
    consensusRange: consensus ? { min: consensus.min, max: consensus.max, count: consensus.count } : null,
    bankForecasts: consensus?.contributors.slice(0, 12) ?? [],
  };
  const { value: out } = await completeJSON<{ en?: string; zh?: string }>(provider, {
    system: SYSTEM,
    user: JSON.stringify(facts),
    // 300-400 words of English plus the same again in Chinese does not fit in 2000 tokens.
    // The completion was being cut mid-string, which reads as invalid JSON, so completeJSON
    // burned its repair retry and threw — every call failed and nothing was ever stored.
    // Output is billed on what is generated, not on the ceiling, so a higher cap is free.
    maxTokens: 4000,
  });
  // Both locales are public. Treat a partial completion as retryable instead of
  // leaving one locale stuck on "Analysis generating…" forever.
  if (!out.en?.trim() || !out.zh?.trim()) return false;
  await prisma.macroRelease.update({
    where: { id: releaseId },
    data: { analysisEn: out.en?.trim() ?? null, analysisZh: out.zh?.trim() ?? null, analysisAt: new Date() },
  });
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
        await recordAttempt(release.id, attempts, "Model returned an incomplete bilingual read-out.");
      }
    } catch (error) {
      // Keep official-data polling alive; backoff decides when this item is selected again.
      await recordAttempt(release.id, attempts, String(error).slice(0, 500));
      console.error(JSON.stringify({ event: "macro.release.analysis.failed", releaseId: release.id, attempts, error: String(error).slice(0, 500) }));
    }
  }
  return generated;
}
