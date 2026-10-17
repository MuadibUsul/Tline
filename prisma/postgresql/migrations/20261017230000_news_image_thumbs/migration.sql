-- News thumbnails, 2026-10-17. A list thumbnail must not download the full map PNG.
-- Existing rows stay NULL until scripts/news-thumbs.ts backfills them; the image route
-- falls back to the original until then.

ALTER TABLE "NewsImage"
  ADD COLUMN "thumbData" BYTEA,
  ADD COLUMN "thumbMimeType" TEXT,
  ADD COLUMN "thumbWidth" INTEGER,
  ADD COLUMN "thumbHeight" INTEGER;
