-- TD and MUFG publish time-sensitive research PDFs behind stable article pages.
-- Poll these lightweight public listings frequently; source-specific ingestion still
-- observes robots.txt and the global politeness floor.
UPDATE "Institution"
SET "crawlIntervalSec" = 300,
    "nextCrawlAt" = LEAST(COALESCE("nextCrawlAt", NOW()), NOW())
WHERE "slug" IN ('td', 'mufg');

-- One-time layout upgrade for recent Natixis PDFs that were previously flattened into
-- one text segment. Removing only the native-document marker makes the crawler revisit
-- and update the same Article row; user-facing IDs and relationships remain intact.
DELETE FROM "ArticleDocument" d
USING "Article" a, "Institution" i
WHERE d."articleId" = a."id"
  AND a."institutionId" = i."id"
  AND i."slug" = 'natixis'
  AND d."kind" = 'source_native'
  AND a."publishedAt" >= TIMESTAMP '2026-09-01 00:00:00'
  AND (SELECT COUNT(*) FROM "ArticleSegment" s WHERE s."articleId" = a."id") <= 1;
