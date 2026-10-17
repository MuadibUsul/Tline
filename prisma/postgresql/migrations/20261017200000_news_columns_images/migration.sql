-- 新鲜事栏目与图片, 2026-10-17. Additive: one nullable column on NewsPost, two new tables.
-- A column is a recurring desk (daily brief, weekly note); an image belongs to one post and
-- is inserted after a paragraph so the original map/figure order survives editing.

CREATE TABLE "NewsColumn" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "descriptionZh" TEXT,
    "descriptionEn" TEXT,
    "cadence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsColumn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsColumn_slug_key" ON "NewsColumn"("slug");

CREATE TABLE "NewsImage" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "alt" TEXT,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsImage_postId_position_idx" ON "NewsImage"("postId", "position");

ALTER TABLE "NewsPost" ADD COLUMN "columnId" TEXT;
CREATE INDEX "NewsPost_columnId_status_publishedAt_idx" ON "NewsPost"("columnId", "status", "publishedAt");

ALTER TABLE "NewsPost" ADD CONSTRAINT "NewsPost_columnId_fkey"
  FOREIGN KEY ("columnId") REFERENCES "NewsColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NewsImage" ADD CONSTRAINT "NewsImage_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "NewsPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
