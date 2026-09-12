ALTER TABLE "Article" ADD COLUMN "slug" TEXT;

UPDATE "Article" AS article
SET "slug" = CONCAT(
  LEFT(COALESCE(NULLIF(
    TRIM(BOTH '-' FROM REGEXP_REPLACE(
      LOWER(CONCAT(institution."name", '-', article."title")),
      '[^a-z0-9]+', '-', 'g'
    )), ''
  ), 'research'), 109),
  '-',
  RIGHT(article."id", 10)
)
FROM "Institution" AS institution
WHERE institution."id" = article."institutionId";

ALTER TABLE "Article" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
