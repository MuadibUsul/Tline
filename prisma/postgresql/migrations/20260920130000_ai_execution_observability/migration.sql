ALTER TABLE "LlmCall"
  ADD COLUMN "contentId" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "executionLevel" TEXT,
  ADD COLUMN "contextStrategy" TEXT,
  ADD COLUMN "cacheStatus" TEXT,
  ADD COLUMN "reasonCodes" TEXT,
  ADD COLUMN "savingsAttribution" TEXT,
  ADD COLUMN "originalEstimatedTokens" INTEGER,
  ADD COLUMN "optimizedEstimatedTokens" INTEGER;

CREATE INDEX "LlmCall_requestFingerprint_idx" ON "LlmCall"("requestFingerprint");

ALTER TABLE "Analysis" ADD COLUMN "sourceContentHash" TEXT;
ALTER TABLE "ArticleTranslation" ADD COLUMN "sourceContentHash" TEXT;

CREATE TABLE "AiExecutionEvent" (
  "id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "contentId" TEXT,
  "requestFingerprint" TEXT,
  "executionLevel" TEXT NOT NULL,
  "requiresLLM" BOOLEAN NOT NULL,
  "requiresDecision" BOOLEAN NOT NULL DEFAULT false,
  "contextStrategy" TEXT NOT NULL,
  "cacheStatus" TEXT NOT NULL,
  "reasonCodes" TEXT NOT NULL,
  "savingsAttribution" TEXT,
  "originalEstimatedTokens" INTEGER NOT NULL DEFAULT 0,
  "optimizedEstimatedTokens" INTEGER NOT NULL DEFAULT 0,
  "actualInputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiExecutionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiExecutionEvent_day_idx" ON "AiExecutionEvent"("day");
CREATE INDEX "AiExecutionEvent_day_task_idx" ON "AiExecutionEvent"("day", "task");
CREATE INDEX "AiExecutionEvent_requestFingerprint_idx" ON "AiExecutionEvent"("requestFingerprint");
CREATE INDEX "AiExecutionEvent_createdAt_idx" ON "AiExecutionEvent"("createdAt");
