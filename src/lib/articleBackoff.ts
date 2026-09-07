import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Per-article, per-pipeline backoff for the two model-backed processing stages.
 *
 * The processing CLIs select their work by absence — "articles with no analysis", "articles
 * with no zh-CN translation" — which is exactly the state an article that cannot be
 * processed stays in. The scheduler runs them every sixty seconds against the newest fifty
 * candidates, so one article that always throws is not one wasted call: it is fifty-odd
 * model calls an hour, forever. Ninety-five articles sat in that state for six days.
 *
 * Failures are counted on the article and gate the next attempt. Nothing here caps a
 * healthy pipeline: the counter resets to zero the moment a stage succeeds.
 */
export type PipelineKind = "analysis" | "translation";

/** Attempts after which an article is abandoned rather than retried on any cadence. */
export const MAX_FAILURES = Math.max(1, Number(process.env.ARTICLE_LLM_MAX_FAILURES || 6));
const BASE_DELAY_MS = Math.max(60_000, Number(process.env.ARTICLE_LLM_BACKOFF_MS || 30 * 60_000));
const MAX_DELAY_MS = Math.max(BASE_DELAY_MS, Number(process.env.ARTICLE_LLM_BACKOFF_MAX_MS || 24 * 60 * 60_000));

const FIELDS = {
  analysis: { count: "analysisFailCount", next: "analysisNextAttemptAt" },
  translation: { count: "translationFailCount", next: "translationNextAttemptAt" },
} as const;

/** 30m, 1h, 2h, 4h … capped at a day, so a transient outage recovers on its own. */
export function backoffDelayMs(failCount: number): number {
  if (failCount < 1) return 0;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failCount - 1));
}

/**
 * Candidate filter: not abandoned, and past its backoff window.
 *
 * Merged into a query with `AND` rather than spread at the top level — the callers already
 * use `OR` for their own selection, and two `OR` keys in one object silently overwrite.
 */
export function dueFilter(kind: PipelineKind, now = new Date()): Prisma.ArticleWhereInput {
  const field = FIELDS[kind];
  return {
    [field.count]: { lt: MAX_FAILURES },
    OR: [{ [field.next]: null }, { [field.next]: { lte: now } }],
  } as Prisma.ArticleWhereInput;
}

/** Count a failed attempt and push the next one out. At MAX_FAILURES the article is dropped. */
export async function recordFailure(articleId: string, kind: PipelineKind, now = new Date()): Promise<number> {
  const field = FIELDS[kind];
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { [field.count]: true },
  }) as Record<string, number> | null;
  if (!article) return 0;
  const failCount = (article[field.count] ?? 0) + 1;
  const abandoned = failCount >= MAX_FAILURES;
  await prisma.article.update({
    where: { id: articleId },
    data: {
      [field.count]: failCount,
      // Abandoned articles carry no next attempt: the count alone excludes them, and a
      // stale timestamp would suggest one is still scheduled.
      [field.next]: abandoned ? null : new Date(now.getTime() + backoffDelayMs(failCount)),
    },
  });
  if (abandoned) {
    console.error(JSON.stringify({ event: "article.pipeline.abandoned", articleId, kind, failCount }));
  }
  return failCount;
}

/** Clear the record after a successful pass, so a recovered article is treated as healthy. */
export async function clearFailures(articleId: string, kind: PipelineKind): Promise<void> {
  const field = FIELDS[kind];
  await prisma.article.updateMany({
    // updateMany, not update: the article may have been deleted by a cleanup between the
    // model call and this write, and a reset is not worth failing a completed pass over.
    where: { id: articleId, NOT: { [field.count]: 0 } },
    data: { [field.count]: 0, [field.next]: null },
  });
}
