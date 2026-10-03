-- The publication gate's verdict, written down.
--
-- Additive and nullable/defaulted, so it is safe to apply while the previous image is serving:
-- every existing row starts as "not indexable" and the backfill (npm run gate:recompute) fills
-- in the truth. Until it runs, listings are empty rather than wrong — which is the direction to
-- fail, since the alternative was advertising pages that answer 404.
ALTER TABLE "Article" ADD COLUMN "indexableEn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Article" ADD COLUMN "indexableZh" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Article" ADD COLUMN "gateIssuesEn" TEXT;
ALTER TABLE "Article" ADD COLUMN "gateIssuesZh" TEXT;
ALTER TABLE "Article" ADD COLUMN "gateCheckedAt" TIMESTAMP(3);

CREATE INDEX "Article_indexableEn_publishedAt_idx" ON "Article"("indexableEn", "publishedAt");
CREATE INDEX "Article_indexableZh_publishedAt_idx" ON "Article"("indexableZh", "publishedAt");
