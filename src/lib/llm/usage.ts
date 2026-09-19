import { dayKey } from "../analytics/identity";
import type { CompletionAudit, CompletionUsage, FinishReason, LlmTask } from "./types";

/**
 * Recording of what each model call actually cost.
 *
 * Every provider returns token counts on the response and the pipeline discarded all of
 * them, so the only way to answer "why is the quota draining" was to estimate from
 * character counts. These rows are the provider's own numbers.
 */
export interface LlmCallRecord {
  task: LlmTask;
  provider: string;
  model: string;
  usage?: CompletionUsage;
  finishReason?: FinishReason;
  durationMs: number;
  ok: boolean;
  error?: string;
  audit?: CompletionAudit;
}

let warned = false;

/**
 * Never throws: a call that succeeded must not be reported as failed because the audit
 * write did. Imported dynamically so the provider module stays usable where Prisma is not.
 */
export async function recordLlmCall(record: LlmCallRecord): Promise<void> {
  try {
    const { prisma } = await import("../db");
    await prisma.llmCall.create({
      data: {
        day: dayKey(),
        task: record.task,
        provider: record.provider,
        model: record.model,
        inputTokens: record.usage?.inputTokens ?? 0,
        outputTokens: record.usage?.outputTokens ?? 0,
        durationMs: record.durationMs,
        ok: record.ok,
        finishReason: record.finishReason ?? null,
        error: record.error?.slice(0, 500) ?? null,
        contentId: record.audit?.contentId ?? null,
        requestFingerprint: record.audit?.requestFingerprint ?? null,
        promptVersion: record.audit?.promptVersion ?? null,
        executionLevel: record.audit?.executionLevel ?? null,
        contextStrategy: record.audit?.contextStrategy ?? null,
        cacheStatus: record.audit?.cacheStatus ?? null,
        reasonCodes: record.audit?.reasonCodes ? JSON.stringify(record.audit.reasonCodes) : null,
        savingsAttribution: record.audit?.savingsAttribution ?? null,
        originalEstimatedTokens: record.audit?.originalEstimatedTokens ?? null,
        optimizedEstimatedTokens: record.audit?.optimizedEstimatedTokens ?? null,
      },
    });
  } catch (error) {
    // Once per process: a broken recorder should be visible without drowning the log in
    // one line per model call.
    if (!warned) {
      warned = true;
      console.error(JSON.stringify({ event: "llm.usage.record.failed", error: String(error).slice(0, 300) }));
    }
  }
}

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  currency: string;
}

/**
 * Money for a bundle of tokens, or null when nobody has entered a price for that model.
 *
 * Null rather than zero on purpose: an unpriced model showing "$0.00" reads as free, which
 * is the one thing it definitely is not.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice | undefined,
): number | null {
  if (!price) return null;
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

export function priceKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}
