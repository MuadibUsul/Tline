-- Five-star releases may publish without waiting for a human decision, when the operator
-- has switched it on from the console. The draft records how it was approved, so the
-- review card, the console and the audit trail can always tell an automatic approval from
-- a reviewed one. Both changes are additive and every existing draft reads as "manual".
ALTER TABLE "SocialDraft" ADD COLUMN "approvalMode" TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE "SocialSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialSetting_pkey" PRIMARY KEY ("key")
);
