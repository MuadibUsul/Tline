-- 新鲜事 (the newsroom stream), 2026-10-17. Additive: one new table, no existing change.
-- A news post is not a crawled report: it does not enter the ingest, translation,
-- classification or social pipelines, and the publication gate does not apply to it —
-- publishing is the operator's own audited action.

CREATE TABLE "NewsPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'brief',
    "titleZh" TEXT,
    "titleEn" TEXT,
    "bodyZh" TEXT,
    "bodyEn" TEXT,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsPost_slug_key" ON "NewsPost"("slug");
CREATE INDEX "NewsPost_status_publishedAt_idx" ON "NewsPost"("status", "publishedAt");

ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
