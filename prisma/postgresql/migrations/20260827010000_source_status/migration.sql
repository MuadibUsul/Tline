ALTER TABLE "Institution"
ADD COLUMN "lastCrawlAt" TIMESTAMP(3),
ADD COLUMN "lastCrawlStatus" TEXT,
ADD COLUMN "lastCrawlMessage" TEXT,
ADD COLUMN "lastSuccessAt" TIMESTAMP(3);
