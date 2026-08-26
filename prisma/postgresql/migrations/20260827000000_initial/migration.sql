-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "homepage" TEXT,
    "researchUrl" TEXT NOT NULL,
    "rssUrl" TEXT,
    "sitemapUrl" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 4,
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "updateFreq" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "crawlPolicy" TEXT NOT NULL DEFAULT 'allowed',
    "crawlDelay" INTEGER,
    "requiresRender" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "urlHash" TEXT NOT NULL,
    "titleHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyArguments" TEXT NOT NULL DEFAULT '[]',
    "keyNumbers" TEXT NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '[]',
    "interpretation" TEXT,
    "importanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "model" TEXT NOT NULL DEFAULT 'mock-rules-v1',
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "reviewStatus" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSegment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "ArticleSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleTranslation" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "glossaryVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'translated',
    "qualityScore" DOUBLE PRECISION,
    "translatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleTranslationSegment" (
    "id" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "sourceSegmentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "ArticleTranslationSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleDocument" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "translationId" TEXT,
    "kind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "pageCount" INTEGER,
    "byteSize" INTEGER,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAsset" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "direction" INTEGER NOT NULL,
    "target" DOUBLE PRECISION,
    "previousTarget" DOUBLE PRECISION,
    "timeHorizon" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "targetDate" TIMESTAMP(3),
    "targetValue" DOUBLE PRECISION,
    "metric" TEXT,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsensusHistory" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consensusScore" INTEGER NOT NULL,
    "institutionCount" INTEGER NOT NULL,
    "bullishCount" INTEGER NOT NULL,
    "neutralCount" INTEGER NOT NULL,
    "bearishCount" INTEGER NOT NULL,

    CONSTRAINT "ConsensusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'pro',
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "assetTicker" TEXT,
    "threshold" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "assetTicker" TEXT,
    "score" INTEGER,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "metrics" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_slug_key" ON "Institution"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Article_urlHash_key" ON "Article"("urlHash");

-- CreateIndex
CREATE INDEX "Article_institutionId_publishedAt_idx" ON "Article"("institutionId", "publishedAt");

-- CreateIndex
CREATE INDEX "Article_titleHash_idx" ON "Article"("titleHash");

-- CreateIndex
CREATE INDEX "Article_contentHash_idx" ON "Article"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_articleId_key" ON "Analysis"("articleId");

-- CreateIndex
CREATE INDEX "ArticleSegment_articleId_idx" ON "ArticleSegment"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleSegment_articleId_position_key" ON "ArticleSegment"("articleId", "position");

-- CreateIndex
CREATE INDEX "ArticleTranslation_status_translatedAt_idx" ON "ArticleTranslation"("status", "translatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTranslation_articleId_locale_key" ON "ArticleTranslation"("articleId", "locale");

-- CreateIndex
CREATE INDEX "ArticleTranslationSegment_sourceSegmentId_idx" ON "ArticleTranslationSegment"("sourceSegmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTranslationSegment_translationId_position_key" ON "ArticleTranslationSegment"("translationId", "position");

-- CreateIndex
CREATE INDEX "ArticleDocument_status_createdAt_idx" ON "ArticleDocument"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleDocument_articleId_kind_locale_key" ON "ArticleDocument"("articleId", "kind", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_ticker_key" ON "Asset"("ticker");

-- CreateIndex
CREATE INDEX "ArticleAsset_assetId_direction_idx" ON "ArticleAsset"("assetId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAsset_articleId_assetId_key" ON "ArticleAsset"("articleId", "assetId");

-- CreateIndex
CREATE INDEX "Forecast_assetId_forecastDate_idx" ON "Forecast"("assetId", "forecastDate");

-- CreateIndex
CREATE INDEX "ConsensusHistory_assetId_timestamp_idx" ON "ConsensusHistory"("assetId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_kind_refId_key" ON "WatchlistItem"("userId", "kind", "refId");

-- CreateIndex
CREATE INDEX "AlertRule_userId_active_idx" ON "AlertRule"("userId", "active");

-- CreateIndex
CREATE INDEX "AlertEvent_ruleId_firedAt_idx" ON "AlertEvent"("ruleId", "firedAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_name_startedAt_idx" ON "JobRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSegment" ADD CONSTRAINT "ArticleSegment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTranslation" ADD CONSTRAINT "ArticleTranslation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTranslationSegment" ADD CONSTRAINT "ArticleTranslationSegment_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ArticleTranslation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTranslationSegment" ADD CONSTRAINT "ArticleTranslationSegment_sourceSegmentId_fkey" FOREIGN KEY ("sourceSegmentId") REFERENCES "ArticleSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleDocument" ADD CONSTRAINT "ArticleDocument_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleDocument" ADD CONSTRAINT "ArticleDocument_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ArticleTranslation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAsset" ADD CONSTRAINT "ArticleAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAsset" ADD CONSTRAINT "ArticleAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsensusHistory" ADD CONSTRAINT "ConsensusHistory_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
