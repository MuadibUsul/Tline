-- Delivery state for alerts, the per-user webhook target, and the operator-requested
-- content retry queue. These arrived in the schema without a matching migration, so a
-- deployed database was missing them and both scheduler workers failed on every pass.

ALTER TABLE "AlertEvent" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE "User" ADD COLUMN     "alertWebhookUrl" TEXT;

CREATE TABLE "ContentRetry" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "scoreBefore" DOUBLE PRECISION,
    "scoreAfter" DOUBLE PRECISION,
    "error" TEXT,

    CONSTRAINT "ContentRetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentRetry_status_requestedAt_idx" ON "ContentRetry"("status", "requestedAt");

CREATE UNIQUE INDEX "ContentRetry_articleId_kind_key" ON "ContentRetry"("articleId", "kind");

CREATE INDEX "AlertEvent_deliveryStatus_firedAt_idx" ON "AlertEvent"("deliveryStatus", "firedAt");

CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");

ALTER TABLE "ContentRetry" ADD CONSTRAINT "ContentRetry_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX "MarketObservation_provider_externalSymbol_observedAt_interval_k" RENAME TO "MarketObservation_provider_externalSymbol_observedAt_interv_key";
