-- Scotiabank Economics can publish more than six reports per day. Keep its discovery
-- cadence aligned with the source-specific full-listing batch configured in code.
UPDATE "Institution"
SET "crawlIntervalSec" = 300,
    "nextCrawlAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'scotiabank';
