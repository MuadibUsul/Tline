ALTER TABLE "Institution" ADD COLUMN "crawlIntervalSec" INTEGER;
ALTER TABLE "Institution" ADD COLUMN "nextCrawlAt" TIMESTAMP(3);
ALTER TABLE "Institution" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Institution" ADD COLUMN "lastDiscoveredAt" TIMESTAMP(3);

CREATE INDEX "Institution_monitoringEnabled_nextCrawlAt_idx" ON "Institution"("monitoringEnabled", "nextCrawlAt");
