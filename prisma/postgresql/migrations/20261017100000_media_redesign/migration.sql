-- Premium-media redesign, phase M1-M3 (docs/redesign/). All additive: two new tables and
-- one nullable column; nothing existing changes, so the previous image keeps running
-- against this schema unchanged (rollback plan §2).

ALTER TABLE "Article" ADD COLUMN "featuredAt" TIMESTAMP(3);
CREATE INDEX "Article_featuredAt_idx" ON "Article"("featuredAt");

CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confirmToken" TEXT NOT NULL,
    "source" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
CREATE UNIQUE INDEX "NewsletterSubscriber_confirmToken_key" ON "NewsletterSubscriber"("confirmToken");
CREATE INDEX "NewsletterSubscriber_status_createdAt_idx" ON "NewsletterSubscriber"("status", "createdAt");

CREATE TABLE "ArticleBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleBookmark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticleBookmark_userId_articleId_key" ON "ArticleBookmark"("userId", "articleId");
CREATE INDEX "ArticleBookmark_userId_createdAt_idx" ON "ArticleBookmark"("userId", "createdAt");

ALTER TABLE "ArticleBookmark" ADD CONSTRAINT "ArticleBookmark_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleBookmark" ADD CONSTRAINT "ArticleBookmark_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
