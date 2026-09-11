CREATE TABLE "SocialPlatformCredential" (
  "platform" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientSecretCipher" TEXT,
  "clientSecretHint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPlatformCredential_pkey" PRIMARY KEY ("platform")
);
