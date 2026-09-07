-- Per-article, per-pipeline model-call backoff.
--
-- The processing CLIs select their work by absence ("no analysis", "no zh-CN translation"),
-- which is exactly the state an article that cannot be processed stays in. The scheduler
-- runs them every sixty seconds against the newest candidates, so one permanently failing
-- article is a permanent, recurring model spend. These columns count failures and gate the
-- next attempt; both reset to zero on success.
--
-- Two pairs, because the pipelines fail independently: a body the translator chokes on is
-- usually still analysable, and a single shared counter would let one stall the other.
ALTER TABLE "Article" ADD COLUMN "analysisFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Article" ADD COLUMN "analysisNextAttemptAt" TIMESTAMP(3);
ALTER TABLE "Article" ADD COLUMN "translationFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Article" ADD COLUMN "translationNextAttemptAt" TIMESTAMP(3);

-- Backfill is intentionally the column defaults: every existing article starts healthy and
-- is retried once more. An article that is genuinely unprocessable earns its own count.

CREATE INDEX "Article_analysisFailCount_analysisNextAttemptAt_idx"
  ON "Article"("analysisFailCount", "analysisNextAttemptAt");
CREATE INDEX "Article_translationFailCount_translationNextAttemptAt_idx"
  ON "Article"("translationFailCount", "translationNextAttemptAt");
