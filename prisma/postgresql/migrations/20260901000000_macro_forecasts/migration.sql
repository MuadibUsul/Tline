ALTER TABLE "MacroRelease" ADD COLUMN "analysisEn" TEXT;
ALTER TABLE "MacroRelease" ADD COLUMN "analysisZh" TEXT;
ALTER TABLE "MacroRelease" ADD COLUMN "analysisAt" TIMESTAMP(3);

CREATE TABLE "MacroForecast" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "indicatorKey" TEXT NOT NULL,
    "referencePeriod" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "quote" TEXT,
    "articleId" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroForecast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MacroForecast_institutionId_indicatorKey_referencePeriod_key" ON "MacroForecast"("institutionId", "indicatorKey", "referencePeriod");

CREATE INDEX "MacroForecast_indicatorKey_referencePeriod_idx" ON "MacroForecast"("indicatorKey", "referencePeriod");

ALTER TABLE "MacroForecast" ADD CONSTRAINT "MacroForecast_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MacroForecast" ADD CONSTRAINT "MacroForecast_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;
