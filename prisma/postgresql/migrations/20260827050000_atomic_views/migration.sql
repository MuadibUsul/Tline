CREATE TABLE "AtomicView" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "viewEn" TEXT NOT NULL,
    "viewZh" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "assetTicker" TEXT,
    "topic" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "timeHorizon" TEXT NOT NULL,
    "value" TEXT,
    "conditionEn" TEXT,
    "conditionZh" TEXT,
    "rationaleEn" TEXT,
    "rationaleZh" TEXT,
    "confidence" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "sourceQuote" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtomicView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AtomicView_articleId_position_key" ON "AtomicView"("articleId", "position");
CREATE INDEX "AtomicView_assetTicker_direction_idx" ON "AtomicView"("assetTicker", "direction");
CREATE INDEX "AtomicView_type_importance_idx" ON "AtomicView"("type", "importance");
CREATE INDEX "AtomicView_topic_idx" ON "AtomicView"("topic");
ALTER TABLE "AtomicView" ADD CONSTRAINT "AtomicView_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
