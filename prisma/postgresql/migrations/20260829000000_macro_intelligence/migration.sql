-- CreateTable
CREATE TABLE "MacroIndicator" (
    "id" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameZh" TEXT,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT,
    "category" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "seasonalAdjustment" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSeriesSource" (
    "id" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalSeriesId" TEXT NOT NULL,
    "dataset" TEXT,
    "tableCode" TEXT,
    "lineCode" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "sourceUrl" TEXT,
    "metadata" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroSeriesSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "id" TEXT NOT NULL,
    "seriesSourceId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "vintageAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "revisionNo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "sourcePublishedAt" TIMESTAMP(3),
    "rawHash" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroRelease" (
    "id" TEXT NOT NULL,
    "releaseKey" TEXT NOT NULL,
    "releaseFamily" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT,
    "agency" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleZh" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sourceTimezone" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "importance" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "sourceUrl" TEXT,
    "externalReleaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroReleaseValue" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "observationPeriod" TIMESTAMP(3) NOT NULL,
    "actualInitial" DECIMAL(65,30),
    "previousAtRelease" DECIMAL(65,30),
    "revisedPreviousAtRelease" DECIMAL(65,30),
    "consensusAtRelease" DECIMAL(65,30),
    "consensusProvider" TEXT,
    "consensusAsOf" TIMESTAMP(3),
    "surpriseRaw" DECIMAL(65,30),
    "surprisePct" DECIMAL(65,30),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroReleaseValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroPolicyDocument" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT,
    "centralBank" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parsedJson" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'unparsed',
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroPolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSyncState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "cursor" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT 'never',
    "lastError" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroSyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketInstrument" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "baseAsset" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketInstrument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketObservation" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalSymbol" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "interval" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "open" DECIMAL(65,30),
    "high" DECIMAL(65,30),
    "low" DECIMAL(65,30),
    "close" DECIMAL(65,30) NOT NULL,
    "sourceUrl" TEXT,
    "rawHash" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MacroSignalSnapshot" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL',
    "methodologyVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "contextJson" TEXT NOT NULL,
    "inputReleaseIds" TEXT NOT NULL,
    "inputObservationIds" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MacroSignalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MacroIndicator_canonicalKey_key" ON "MacroIndicator"("canonicalKey");
CREATE INDEX "MacroIndicator_countryCode_category_enabled_idx" ON "MacroIndicator"("countryCode", "category", "enabled");

CREATE UNIQUE INDEX "MacroSeriesSource_provider_externalSeriesId_key" ON "MacroSeriesSource"("provider", "externalSeriesId");
CREATE INDEX "MacroSeriesSource_indicatorId_enabled_priority_idx" ON "MacroSeriesSource"("indicatorId", "enabled", "priority");

CREATE UNIQUE INDEX "MacroObservation_seriesSourceId_period_vintageAt_key" ON "MacroObservation"("seriesSourceId", "period", "vintageAt");
CREATE UNIQUE INDEX "MacroObservation_seriesSourceId_period_revisionNo_key" ON "MacroObservation"("seriesSourceId", "period", "revisionNo");
CREATE INDEX "MacroObservation_seriesSourceId_vintageAt_idx" ON "MacroObservation"("seriesSourceId", "vintageAt");
CREATE INDEX "MacroObservation_period_status_idx" ON "MacroObservation"("period", "status");

CREATE UNIQUE INDEX "MacroRelease_releaseKey_key" ON "MacroRelease"("releaseKey");
CREATE INDEX "MacroRelease_status_scheduledAt_idx" ON "MacroRelease"("status", "scheduledAt");
CREATE INDEX "MacroRelease_releaseFamily_scheduledAt_idx" ON "MacroRelease"("releaseFamily", "scheduledAt");
CREATE INDEX "MacroRelease_agency_externalReleaseId_idx" ON "MacroRelease"("agency", "externalReleaseId");

CREATE UNIQUE INDEX "MacroReleaseValue_releaseId_indicatorId_key" ON "MacroReleaseValue"("releaseId", "indicatorId");
CREATE INDEX "MacroReleaseValue_indicatorId_observationPeriod_idx" ON "MacroReleaseValue"("indicatorId", "observationPeriod");

CREATE UNIQUE INDEX "MacroPolicyDocument_sourceUrl_contentHash_key" ON "MacroPolicyDocument"("sourceUrl", "contentHash");
CREATE INDEX "MacroPolicyDocument_releaseId_idx" ON "MacroPolicyDocument"("releaseId");
CREATE INDEX "MacroPolicyDocument_centralBank_docType_publishedAt_idx" ON "MacroPolicyDocument"("centralBank", "docType", "publishedAt");
CREATE INDEX "MacroPolicyDocument_contentHash_idx" ON "MacroPolicyDocument"("contentHash");

CREATE UNIQUE INDEX "MacroSyncState_provider_scopeKey_key" ON "MacroSyncState"("provider", "scopeKey");
CREATE INDEX "MacroSyncState_lastStatus_lastSuccessAt_idx" ON "MacroSyncState"("lastStatus", "lastSuccessAt");

CREATE UNIQUE INDEX "MarketInstrument_symbol_key" ON "MarketInstrument"("symbol");
CREATE INDEX "MarketInstrument_assetClass_enabled_idx" ON "MarketInstrument"("assetClass", "enabled");
CREATE UNIQUE INDEX "MarketObservation_provider_externalSymbol_observedAt_interval_key" ON "MarketObservation"("provider", "externalSymbol", "observedAt", "interval");
CREATE INDEX "MarketObservation_instrumentId_observedAt_idx" ON "MarketObservation"("instrumentId", "observedAt");
CREATE INDEX "MarketObservation_quality_fetchedAt_idx" ON "MarketObservation"("quality", "fetchedAt");
CREATE INDEX "MacroSignalSnapshot_scopeKey_generatedAt_idx" ON "MacroSignalSnapshot"("scopeKey", "generatedAt");
CREATE INDEX "MacroSignalSnapshot_methodologyVersion_generatedAt_idx" ON "MacroSignalSnapshot"("methodologyVersion", "generatedAt");

-- AddForeignKey
ALTER TABLE "MacroSeriesSource" ADD CONSTRAINT "MacroSeriesSource_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "MacroIndicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MacroObservation" ADD CONSTRAINT "MacroObservation_seriesSourceId_fkey" FOREIGN KEY ("seriesSourceId") REFERENCES "MacroSeriesSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MacroReleaseValue" ADD CONSTRAINT "MacroReleaseValue_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MacroRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MacroReleaseValue" ADD CONSTRAINT "MacroReleaseValue_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "MacroIndicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MacroPolicyDocument" ADD CONSTRAINT "MacroPolicyDocument_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MacroRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketObservation" ADD CONSTRAINT "MarketObservation_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "MarketInstrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
