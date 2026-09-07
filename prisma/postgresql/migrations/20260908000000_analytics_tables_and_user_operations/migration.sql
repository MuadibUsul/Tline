-- Tables and columns that reached prisma/schema.prisma without a PostgreSQL migration.
--
-- The console rebuild added audience analytics (PageView, AnalyticsEvent, WebVital,
-- TrafficDaily, ApiUsageDaily) and the operator fields on User (suspendedAt, lastSeenAt,
-- note) to the schema, but no migration was written for any of them. `migrate deploy`
-- reported "up to date" because every migration it knew about had been applied, so the
-- drift was invisible to the one command that would have caught it.
--
-- The cost was total: prisma.user.findUnique() selects every scalar field, so a missing
-- User column failed every read of that table. Sign-in returned 500 whichever way it was
-- attempted, and no account could be entered at all.
--
-- Generated with `prisma migrate diff` against the live database, so it states exactly the
-- difference and nothing else. Additive throughout: no column or table is dropped.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "isEntry" BOOLEAN NOT NULL DEFAULT false,
    "referrerHost" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "country" TEXT,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "os" TEXT,
    "browser" TEXT,
    "durationMs" INTEGER,
    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "value" DOUBLE PRECISION,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "WebVital" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "rating" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    CONSTRAINT "WebVital_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "TrafficDaily" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TrafficDaily_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ApiUsageDaily" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ApiUsageDaily_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "PageView_day_path_idx" ON "PageView"("day", "path");
-- CreateIndex
CREATE INDEX "PageView_ts_idx" ON "PageView"("ts");
-- CreateIndex
CREATE INDEX "PageView_visitorId_ts_idx" ON "PageView"("visitorId", "ts");
-- CreateIndex
CREATE INDEX "PageView_sessionId_ts_idx" ON "PageView"("sessionId", "ts");
-- CreateIndex
CREATE INDEX "PageView_userId_ts_idx" ON "PageView"("userId", "ts");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_day_name_idx" ON "AnalyticsEvent"("day", "name");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_ts_idx" ON "AnalyticsEvent"("ts");
-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_ts_idx" ON "AnalyticsEvent"("userId", "ts");
-- CreateIndex
CREATE INDEX "WebVital_day_metric_idx" ON "WebVital"("day", "metric");
-- CreateIndex
CREATE INDEX "WebVital_ts_idx" ON "WebVital"("ts");
-- CreateIndex
CREATE INDEX "TrafficDaily_dimension_day_idx" ON "TrafficDaily"("dimension", "day");
-- CreateIndex
CREATE UNIQUE INDEX "TrafficDaily_day_dimension_value_key" ON "TrafficDaily"("day", "dimension", "value");
-- CreateIndex
CREATE INDEX "ApiUsageDaily_day_idx" ON "ApiUsageDaily"("day");
-- CreateIndex
CREATE INDEX "ApiUsageDaily_keyId_day_idx" ON "ApiUsageDaily"("keyId", "day");
-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageDaily_day_keyId_endpoint_status_key" ON "ApiUsageDaily"("day", "keyId", "endpoint", "status");
