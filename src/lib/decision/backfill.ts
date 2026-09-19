import { createHash } from "node:crypto";

export interface PriorDecisionAttempt {
  ok: boolean;
  createdAt: Date;
}

export type DecisionRetryState =
  | { status: "READY" }
  | { status: "COMPLETE" }
  | { status: "WAIT"; nextAttemptAt: Date }
  | { status: "EXHAUSTED" };

export function decisionFingerprint(input: {
  contentHash: string;
  taxonomyVersion: string;
  provider: string;
  model: string;
  questionIds: string[];
}): string {
  return createHash("sha256").update(JSON.stringify({ ...input, questionIds: [...input.questionIds].sort() })).digest("hex");
}

export function decisionRetryState(
  attempts: PriorDecisionAttempt[],
  now = new Date(),
  options: { maxFailures?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): DecisionRetryState {
  if (attempts.some((attempt) => attempt.ok)) return { status: "COMPLETE" };
  const failures = attempts.length;
  const maxFailures = Math.max(1, options.maxFailures ?? 3);
  if (failures >= maxFailures) return { status: "EXHAUSTED" };
  if (!failures) return { status: "READY" };

  const base = Math.max(0, options.baseDelayMs ?? 60_000);
  const cap = Math.max(base, options.maxDelayMs ?? 3_600_000);
  const delay = Math.min(cap, base * (2 ** (failures - 1)));
  const latest = Math.max(...attempts.map((attempt) => attempt.createdAt.getTime()));
  const nextAttemptAt = new Date(latest + delay);
  return nextAttemptAt <= now ? { status: "READY" } : { status: "WAIT", nextAttemptAt };
}

export interface ShadowComparisonRow {
  ok: boolean;
  selectedValue: string | null;
  baselineValue: string | null;
}

const parseMap = (value: string | null): Record<string, string | number> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number"));
  } catch {
    return {};
  }
};

export function summarizeShadowComparisons(rows: ShadowComparisonRow[]) {
  let comparableDecisions = 0;
  let agreements = 0;
  let resolvedFromUnknown = 0;
  for (const row of rows.filter((item) => item.ok)) {
    const selected = parseMap(row.selectedValue);
    const baseline = parseMap(row.baselineValue);
    for (const [key, value] of Object.entries(selected)) {
      if (!(key in baseline)) continue;
      comparableDecisions += 1;
      if (String(baseline[key]) === String(value)) agreements += 1;
      else if (baseline[key] === "UNKNOWN" && value !== "UNKNOWN") resolvedFromUnknown += 1;
    }
  }
  return {
    calls: rows.length,
    successful: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    comparableDecisions,
    agreements,
    disagreements: comparableDecisions - agreements,
    resolvedFromUnknown,
  };
}

export type ExpectedDecisionValue = string | number | Array<string | number>;

export interface DecisionEvalLabel {
  decisionCallId?: string;
  requestFingerprint?: string;
  expected: Record<string, ExpectedDecisionValue>;
}

export interface DecisionEvalCall extends ShadowComparisonRow {
  id: string;
  requestFingerprint?: string | null;
  inputTokens: number;
  outputTokens: number;
}

const values = (value: ExpectedDecisionValue): Array<string | number> => Array.isArray(value) ? value : [value];
const unknown = (value: string | number) => String(value).toUpperCase() === "UNKNOWN";

/** Human/manual labels are the truth; this function only measures and never promotes a gate. */
export function evaluateShadowLabels(calls: DecisionEvalCall[], labels: DecisionEvalLabel[]) {
  const byCall = new Map(labels.flatMap((label) => label.decisionCallId ? [[label.decisionCallId, label.expected] as const] : []));
  const byFingerprint = new Map(labels.flatMap((label) => label.requestFingerprint ? [[label.requestFingerprint, label.expected] as const] : []));
  const counters = { decisions: 0, correct: 0, falseNegative: 0, falsePositive: 0, wrongKnown: 0, knownExpected: 0, knownCorrect: 0 };
  const perQuestion: Record<string, typeof counters> = {};
  let labeledCalls = 0;

  for (const call of calls) {
    const expected = byCall.get(call.id) ?? (call.requestFingerprint ? byFingerprint.get(call.requestFingerprint) : undefined);
    if (!call.ok || !expected) continue;
    const selected = parseMap(call.selectedValue);
    let compared = false;
    for (const [question, expectedValue] of Object.entries(expected)) {
      if (!(question in selected)) continue;
      compared = true;
      const actual = selected[question];
      const accepted = values(expectedValue);
      const target = perQuestion[question] ??= { decisions: 0, correct: 0, falseNegative: 0, falsePositive: 0, wrongKnown: 0, knownExpected: 0, knownCorrect: 0 };
      for (const bucket of [counters, target]) {
        bucket.decisions += 1;
        const expectsKnown = accepted.some((value) => !unknown(value));
        if (expectsKnown) bucket.knownExpected += 1;
        if (accepted.some((value) => String(value) === String(actual))) {
          bucket.correct += 1;
          if (expectsKnown) bucket.knownCorrect += 1;
        } else if (expectsKnown && unknown(actual)) bucket.falseNegative += 1;
        else if (!expectsKnown && !unknown(actual)) bucket.falsePositive += 1;
        else bucket.wrongKnown += 1;
      }
    }
    if (compared) labeledCalls += 1;
  }

  const successful = calls.filter((call) => call.ok);
  const ratio = (part: number, total: number) => total ? part / total : null;
  return {
    calls: calls.length,
    successfulCalls: successful.length,
    labeledCalls,
    labelCoverage: ratio(labeledCalls, successful.length),
    ...counters,
    accuracy: ratio(counters.correct, counters.decisions),
    knownRecall: ratio(counters.knownCorrect, counters.knownExpected),
    totalInputTokens: successful.reduce((sum, call) => sum + call.inputTokens, 0),
    totalOutputTokens: successful.reduce((sum, call) => sum + call.outputTokens, 0),
    perQuestion,
  };
}
