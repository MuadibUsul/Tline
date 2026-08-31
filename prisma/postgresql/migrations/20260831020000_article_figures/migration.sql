CREATE TABLE "ArticleFigure" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "afterSegmentPosition" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sourceUrl" TEXT NOT NULL,
    "alt" TEXT,
    "caption" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleFigure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticleFigure_articleId_afterSegmentPosition_ordinal_key" ON "ArticleFigure"("articleId", "afterSegmentPosition", "ordinal");

CREATE INDEX "ArticleFigure_articleId_idx" ON "ArticleFigure"("articleId");

ALTER TABLE "ArticleFigure" ADD CONSTRAINT "ArticleFigure_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
