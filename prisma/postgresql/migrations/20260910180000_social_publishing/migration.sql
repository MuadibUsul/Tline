CREATE TABLE "SocialDraft" (
  "id" TEXT NOT NULL, "sourceKind" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "textEn" TEXT NOT NULL, "textZh" TEXT NOT NULL, "routeSnapshot" TEXT NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "feishuMessageId" TEXT, "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
  "notifyError" TEXT, "notifiedAt" TIMESTAMP(3), "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3), "rejectedById" TEXT, "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialDraft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SocialAccount" (
  "id" TEXT NOT NULL, "platform" TEXT NOT NULL DEFAULT 'x', "label" TEXT NOT NULL,
  "language" TEXT NOT NULL, "externalAccountId" TEXT, "externalUsername" TEXT,
  "accessTokenCipher" TEXT, "refreshTokenCipher" TEXT, "tokenExpiresAt" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT false, "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SocialRoute" (
  "id" TEXT NOT NULL, "sourceKind" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SocialRoute_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SocialDelivery" (
  "id" TEXT NOT NULL, "draftId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "language" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "mainPostId" TEXT, "replyPostId" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT,
  "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SocialDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialDraft_sourceKind_sourceId_key" ON "SocialDraft"("sourceKind", "sourceId");
CREATE INDEX "SocialDraft_status_createdAt_idx" ON "SocialDraft"("status", "createdAt");
CREATE INDEX "SocialAccount_platform_enabled_idx" ON "SocialAccount"("platform", "enabled");
CREATE UNIQUE INDEX "SocialAccount_platform_externalAccountId_key" ON "SocialAccount"("platform", "externalAccountId");
CREATE UNIQUE INDEX "SocialRoute_sourceKind_accountId_key" ON "SocialRoute"("sourceKind", "accountId");
CREATE INDEX "SocialRoute_sourceKind_enabled_idx" ON "SocialRoute"("sourceKind", "enabled");
CREATE UNIQUE INDEX "SocialDelivery_draftId_accountId_key" ON "SocialDelivery"("draftId", "accountId");
CREATE INDEX "SocialDelivery_status_nextAttemptAt_idx" ON "SocialDelivery"("status", "nextAttemptAt");
ALTER TABLE "SocialRoute" ADD CONSTRAINT "SocialRoute_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialDelivery" ADD CONSTRAINT "SocialDelivery_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SocialDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialDelivery" ADD CONSTRAINT "SocialDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
