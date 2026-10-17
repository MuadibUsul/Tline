-- 新鲜事的多个来源, 2026-10-17. A daily brief cites the same public dashboards every day;
-- source URLs are display metadata, never a uniqueness key, unlike a research report's
-- urlHash (one report per source URL).

CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsSource_postId_position_idx" ON "NewsSource"("postId", "position");

ALTER TABLE "NewsSource" ADD CONSTRAINT "NewsSource_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "NewsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
