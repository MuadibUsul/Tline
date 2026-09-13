-- Additive, backward-compatible data-loop migration. Existing rows remain UNKNOWN
-- until an operator records identity, quality and licence evidence.
ALTER TABLE "Forecast" ADD COLUMN "forecastType" TEXT NOT NULL DEFAULT 'DIRECTION_OR_TARGET';
ALTER TABLE "Forecast" ADD COLUMN "baseObservationId" TEXT;
ALTER TABLE "Forecast" ADD COLUMN "actualObservationId" TEXT;
ALTER TABLE "Forecast" ADD COLUMN "settlementRuleVersion" TEXT;
ALTER TABLE "Forecast" ADD COLUMN "settlementReason" TEXT;

ALTER TABLE "PriceObservation" ADD COLUMN "sourceObservationId" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "licenseKey" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'MARKET';
ALTER TABLE "PriceObservation" ADD COLUMN "unit" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "priceType" TEXT;
ALTER TABLE "PriceObservation" ADD COLUMN "isProxy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MarketInstrument" ADD COLUMN "assetId" TEXT;
ALTER TABLE "MarketInstrument" ADD COLUMN "venue" TEXT;
ALTER TABLE "MarketInstrument" ADD COLUMN "instrumentType" TEXT NOT NULL DEFAULT 'SPOT';
ALTER TABLE "MarketInstrument" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'PRICE';
ALTER TABLE "MarketInstrument" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "MarketInstrument" ADD COLUMN "priceType" TEXT NOT NULL DEFAULT 'LAST';
ALTER TABLE "MarketInstrument" ADD COLUMN "adjustment" TEXT;
ALTER TABLE "MarketInstrument" ADD COLUMN "isProxy" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "MarketInstrument_assetId_idx" ON "MarketInstrument"("assetId");
ALTER TABLE "MarketInstrument" ADD CONSTRAINT "MarketInstrument_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketInstrumentSource" (
  "id" TEXT NOT NULL, "instrumentId" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "externalSymbol" TEXT NOT NULL, "venue" TEXT, "quoteCurrency" TEXT NOT NULL,
  "licenseKey" TEXT, "priority" INTEGER NOT NULL DEFAULT 100, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketInstrumentSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketInstrumentSource_provider_externalSymbol_key" ON "MarketInstrumentSource"("provider", "externalSymbol");
CREATE INDEX "MarketInstrumentSource_instrumentId_enabled_priority_idx" ON "MarketInstrumentSource"("instrumentId", "enabled", "priority");
ALTER TABLE "MarketInstrumentSource" ADD CONSTRAINT "MarketInstrumentSource_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "MarketInstrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketObservation" ADD COLUMN "providerUpdatedAt" TIMESTAMP(3);
ALTER TABLE "MarketObservation" ADD COLUMN "providerDelaySeconds" INTEGER;
ALTER TABLE "MarketObservation" ADD COLUMN "marketState" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "MarketObservation" ADD COLUMN "priceType" TEXT NOT NULL DEFAULT 'LAST';
ALTER TABLE "MarketObservation" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'PRICE';
ALTER TABLE "MarketObservation" ADD COLUMN "licenseKey" TEXT;

CREATE TABLE "DataLicensePolicy" (
  "id" TEXT NOT NULL, "datasetKey" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN', "allowedUses" TEXT NOT NULL DEFAULT '[]',
  "evidenceUrl" TEXT, "confirmedBy" TEXT, "confirmedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3),
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "DataLicensePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DataLicensePolicy_datasetKey_key" ON "DataLicensePolicy"("datasetKey");
CREATE INDEX "DataLicensePolicy_provider_status_idx" ON "DataLicensePolicy"("provider", "status");

CREATE TABLE "ProviderUsage" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "window" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL, "usedUnits" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderUsage_provider_window_periodKey_key" ON "ProviderUsage"("provider", "window", "periodKey");
CREATE INDEX "ProviderUsage_provider_updatedAt_idx" ON "ProviderUsage"("provider", "updatedAt");

CREATE TABLE "MacroExpectation" (
  "id" TEXT NOT NULL, "releaseId" TEXT NOT NULL, "indicatorId" TEXT NOT NULL,
  "referencePeriod" TIMESTAMP(3) NOT NULL, "releaseStage" TEXT NOT NULL DEFAULT 'INITIAL',
  "type" TEXT NOT NULL, "source" TEXT NOT NULL, "sourceEventId" TEXT, "rawField" TEXT,
  "sourceUrl" TEXT, "licenseKey" TEXT, "value" DECIMAL(65,30) NOT NULL, "unit" TEXT NOT NULL,
  "seasonalAdjustment" TEXT, "annualization" TEXT, "sourcePublishedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL, "sampleSize" INTEGER, "surveyMethod" TEXT,
  "entryMethod" TEXT NOT NULL DEFAULT 'MANUAL', "operatorId" TEXT,
  "historicalReconstruction" BOOLEAN NOT NULL DEFAULT false, "revisionNo" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MacroExpectation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MacroExpectation_releaseId_indicatorId_type_source_revisionNo_key" ON "MacroExpectation"("releaseId", "indicatorId", "type", "source", "revisionNo");
CREATE INDEX "MacroExpectation_releaseId_indicatorId_type_capturedAt_idx" ON "MacroExpectation"("releaseId", "indicatorId", "type", "capturedAt");
ALTER TABLE "MacroExpectation" ADD CONSTRAINT "MacroExpectation_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MacroRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MacroExpectation" ADD CONSTRAINT "MacroExpectation_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "MacroIndicator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MacroReleaseValue" ADD COLUMN "consensusExpectationId" TEXT;
ALTER TABLE "MacroReleaseValue" ADD COLUMN "modelExpectationId" TEXT;
CREATE INDEX "MacroReleaseValue_consensusExpectationId_idx" ON "MacroReleaseValue"("consensusExpectationId");
ALTER TABLE "MacroReleaseValue" ADD CONSTRAINT "MacroReleaseValue_consensusExpectationId_fkey" FOREIGN KEY ("consensusExpectationId") REFERENCES "MacroExpectation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MacroReleaseValue" ADD CONSTRAINT "MacroReleaseValue_modelExpectationId_fkey" FOREIGN KEY ("modelExpectationId") REFERENCES "MacroExpectation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TradingThemeSnapshot" (
  "id" TEXT NOT NULL, "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL', "methodologyVersion" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL, "themesJson" TEXT NOT NULL, "inputViewIds" TEXT NOT NULL,
  "inputObservationIds" TEXT NOT NULL, "coverageJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingThemeSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TradingThemeSnapshot_scopeKey_generatedAt_idx" ON "TradingThemeSnapshot"("scopeKey", "generatedAt");
