-- Schroders' public listing is a client-rendered shell. Point production at the complete
-- locale sitemap and schedule a near-term pass so existing truncated review titles are
-- refreshed by the source-specific repair path.
UPDATE "Institution"
SET "sitemapUrl" = 'https://www.schroders.com/en/global/individual/sitemap.xml',
    "crawlIntervalSec" = 300,
    "nextCrawlAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'schroders';
