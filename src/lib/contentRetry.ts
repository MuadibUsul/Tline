import { prisma } from "./db";

/**
 * Operator-driven reprocessing of one article's AI output.
 *
 * A retry that leaves no record is indistinguishable from one that never ran, so every
 * request carries its outcome: the quality score before, the score after, and the error if
 * the rerun failed. That is what makes "queued for improvement" a claim rather than a hope.
 */
export const RETRY_KINDS = ["analysis", "translation"] as const;
export type RetryKind = (typeof RETRY_KINDS)[number];

export function retryPassed(kind: RetryKind, score: number | null): boolean {
  return kind === "analysis" ? score === 1 : score !== null && score >= 0.8;
}

export function isRetryKind(value: string): value is RetryKind {
  return (RETRY_KINDS as readonly string[]).includes(value);
}

/** Current quality score for the kind being retried, so improvement is measurable. */
export async function currentScore(articleId: string, kind: RetryKind): Promise<number | null> {
  if (kind === "translation") {
    const translation = await prisma.articleTranslation.findFirst({
      where: { articleId, locale: "zh-CN" },
      select: { qualityScore: true },
    });
    return translation?.qualityScore ?? null;
  }
  const analysis = await prisma.analysis.findUnique({
    where: { articleId },
    select: { reviewStatus: true },
  });
  // Analysis has no continuous score; review status is the signal, mapped to 0/1.
  return analysis ? (analysis.reviewStatus === "ok" ? 1 : 0) : null;
}

/**
 * How many times an article's output is re-run before the queue stops asking.
 *
 * Without a ceiling this queue is an infinite loop, and it ran as one. A pipeline that
 * cannot reach its threshold re-queues itself every time it finishes — `translate` calls
 * `queueRetry` whenever a draft lands in `needs_review`, and `reparse` whenever a report
 * does not ground — and a retry that fails writes the same failing output back, which
 * queues it again. Production held 191 analysis retries averaging twelve attempts and one
 * that had reached **2,153**, and 158 translation retries up to 155. Every attempt is a
 * model call, so the queue was a standing bill for work that had already been proved
 * impossible: a translation scoring 0.70 cannot reach the 0.80 threshold by being asked
 * again, because the score is capped by a policy the rerun does not change.
 *
 * The cap governs automatic re-queueing only. An operator who asks for a retry from the
 * console has a reason the queue does not know about — a prompt fix, a glossary change —
 * and is not refused because the article has been tried before.
 */
export const MAX_AUTOMATIC_RETRY_ATTEMPTS = 3;

/**
 * Queue a retry, or re-queue one that already finished. A retry still queued or running is
 * left alone rather than duplicated — the unique key is (articleId, kind).
 */
export async function queueRetry(articleId: string, kind: RetryKind, requestedById?: string | null) {
  const existing = await prisma.contentRetry.findUnique({
    where: { articleId_kind: { articleId, kind } },
  });
  if (existing && (existing.status === "queued" || existing.status === "running")) return existing;
  // Exhausted, and nobody asked for it by hand: leave the record as it is. It keeps its
  // attempt count and its error, which is what makes "this one was given up on" auditable.
  if (!requestedById && existing && existing.attempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS) return existing;

  const scoreBefore = await currentScore(articleId, kind);
  return prisma.contentRetry.upsert({
    where: { articleId_kind: { articleId, kind } },
    create: { articleId, kind, requestedById: requestedById ?? null, scoreBefore },
    update: {
      status: "queued",
      requestedById: requestedById ?? null,
      requestedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      scoreBefore,
      scoreAfter: null,
      error: null,
    },
  });
}

/** Claim the oldest queued retries of one kind, marking them running so a second pass skips them. */
export async function claimQueuedRetries(kind: RetryKind, limit: number) {
  // Rows already past the ceiling are closed first, so the backlog left by the unbounded
  // era is retired instead of being drained once more.
  await prisma.contentRetry.updateMany({
    where: { kind, status: { in: ["queued", "running"] }, attempt: { gte: MAX_AUTOMATIC_RETRY_ATTEMPTS } },
    data: {
      status: "failed",
      startedAt: null,
      finishedAt: new Date(),
      error: `stopped after ${MAX_AUTOMATIC_RETRY_ATTEMPTS} attempts: the rerun does not change what the pipeline produces`,
    },
  });
  const queued = await prisma.contentRetry.findMany({
    where: { kind, status: "queued" },
    orderBy: { requestedAt: "asc" },
    take: limit,
    select: { id: true, articleId: true, attempt: true },
  });
  if (!queued.length) return [];
  await prisma.contentRetry.updateMany({
    where: { id: { in: queued.map((row) => row.id) } },
    data: { status: "running", startedAt: new Date() },
  });
  return queued;
}

/** Record the outcome. The score is re-read after the rerun so the delta is measured, not assumed. */
export async function completeRetry(id: string, articleId: string, kind: RetryKind, error?: string | null) {
  const scoreAfter = await currentScore(articleId, kind);
  const row = await prisma.contentRetry.findUnique({ where: { id }, select: { attempt: true } });
  const outcomeError = error ?? (retryPassed(kind, scoreAfter) ? null : `quality threshold not met (${scoreAfter ?? "missing"})`);
  return prisma.contentRetry.update({
    where: { id },
    data: {
      status: outcomeError ? "failed" : "succeeded",
      finishedAt: new Date(),
      attempt: (row?.attempt ?? 0) + 1,
      scoreAfter,
      error: outcomeError ? outcomeError.slice(0, 500) : null,
    },
  });
}

/** Release anything left running by a worker that died, so it is retried rather than stuck. */
export async function releaseStaleRetries(olderThanMs = 30 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.contentRetry.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "queued", startedAt: null },
  });
  return count;
}
