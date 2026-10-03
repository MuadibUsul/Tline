-- A table from the publisher's page, kept as a table rather than flattened into the prose.
--
-- Anchored to a body segment like a figure, which is what keeps this additive: inserting a
-- table leaves "ArticleSegment" untouched, so a report that already has a translation does
-- not have its segments renumbered and its translation invalidated by gaining a table.
CREATE TABLE "ArticleTable" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "afterSegmentPosition" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "caption" TEXT,
    "headerRow" BOOLEAN NOT NULL DEFAULT true,
    "dataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleTable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArticleTable_articleId_afterSegmentPosition_ordinal_key" ON "ArticleTable"("articleId", "afterSegmentPosition", "ordinal");

CREATE INDEX "ArticleTable_articleId_idx" ON "ArticleTable"("articleId");

ALTER TABLE "ArticleTable" ADD CONSTRAINT "ArticleTable_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
