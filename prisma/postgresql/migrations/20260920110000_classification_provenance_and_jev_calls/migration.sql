ALTER TABLE "ContentClassification"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "classifier" TEXT,
    ADD COLUMN "classifierVersion" TEXT,
    ADD COLUMN "fingerprint" TEXT,
    ADD COLUMN "classifiedAt" TIMESTAMP(3);

CREATE INDEX "ContentClassification_status_idx" ON "ContentClassification"("status");
CREATE INDEX "ContentClassification_fingerprint_idx" ON "ContentClassification"("fingerprint");

CREATE TABLE "DecisionCall" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "classificationId" TEXT,
    "requestFingerprint" TEXT,
    "inputBytes" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DOUBLE PRECISION,
    "selectedValue" TEXT,
    "baselineValue" TEXT,
    "shadowMode" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DecisionCall_day_idx" ON "DecisionCall"("day");
CREATE INDEX "DecisionCall_day_provider_model_idx" ON "DecisionCall"("day", "provider", "model");
CREATE INDEX "DecisionCall_decisionType_createdAt_idx" ON "DecisionCall"("decisionType", "createdAt");
CREATE INDEX "DecisionCall_classificationId_idx" ON "DecisionCall"("classificationId");
CREATE INDEX "DecisionCall_requestFingerprint_idx" ON "DecisionCall"("requestFingerprint");

ALTER TABLE "DecisionCall" ADD CONSTRAINT "DecisionCall_classificationId_fkey"
    FOREIGN KEY ("classificationId") REFERENCES "ContentClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
