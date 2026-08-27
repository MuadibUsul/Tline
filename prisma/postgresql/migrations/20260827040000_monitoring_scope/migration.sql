ALTER TABLE "AlertRule" ADD COLUMN "scopeKind" TEXT NOT NULL DEFAULT 'asset';
ALTER TABLE "AlertRule" ADD COLUMN "scopeRef" TEXT;

UPDATE "AlertRule" SET "scopeRef" = "assetTicker" WHERE "assetTicker" IS NOT NULL;
UPDATE "AlertRule" SET "scopeKind" = 'market' WHERE "assetTicker" IS NULL;

CREATE INDEX "AlertRule_scopeKind_scopeRef_idx" ON "AlertRule"("scopeKind", "scopeRef");

ALTER TABLE "AlertEvent" ADD COLUMN "targetId" TEXT;
CREATE INDEX "AlertEvent_ruleId_targetId_idx" ON "AlertEvent"("ruleId", "targetId");
