ALTER TABLE "DecisionCall" ADD COLUMN "contentId" TEXT;

CREATE INDEX "DecisionCall_contentId_idx" ON "DecisionCall"("contentId");
