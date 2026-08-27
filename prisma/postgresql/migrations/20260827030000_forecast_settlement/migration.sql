ALTER TABLE "Forecast"
ADD COLUMN "articleAssetId" TEXT,
ADD COLUMN "direction" INTEGER,
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "baseValue" DOUBLE PRECISION,
ADD COLUMN "actualValue" DOUBLE PRECISION,
ADD COLUMN "absoluteError" DOUBLE PRECISION,
ADD COLUMN "percentageError" DOUBLE PRECISION,
ADD COLUMN "directionCorrect" BOOLEAN,
ADD COLUMN "settlementSource" TEXT,
ADD COLUMN "settledAt" TIMESTAMP(3);

CREATE TABLE "PriceObservation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Forecast_articleAssetId_key" ON "Forecast"("articleAssetId");
CREATE INDEX "Forecast_institutionId_status_idx" ON "Forecast"("institutionId", "status");
CREATE INDEX "Forecast_status_targetDate_idx" ON "Forecast"("status", "targetDate");
CREATE UNIQUE INDEX "PriceObservation_assetId_timestamp_source_key" ON "PriceObservation"("assetId", "timestamp", "source");
CREATE INDEX "PriceObservation_assetId_timestamp_idx" ON "PriceObservation"("assetId", "timestamp");
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_articleAssetId_fkey" FOREIGN KEY ("articleAssetId") REFERENCES "ArticleAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceObservation" ADD CONSTRAINT "PriceObservation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
