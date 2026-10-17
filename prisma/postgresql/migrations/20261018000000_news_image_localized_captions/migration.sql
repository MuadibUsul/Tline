-- Localized news image captions, 2026-10-17. The desk types one caption; the newsroom
-- translation pass fills the other language without overwriting the source text.

ALTER TABLE "NewsImage"
  ADD COLUMN "captionZh" TEXT,
  ADD COLUMN "captionEn" TEXT,
  ADD COLUMN "altZh" TEXT,
  ADD COLUMN "altEn" TEXT;
