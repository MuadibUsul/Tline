-- Publication drafts submitted through the Publisher MCP.
--
-- Its own table, not an Article: nothing unreviewed may leak into the crawler, translation,
-- classification, sitemap or social pipelines, and the only door from here into publishing
-- is the review queue in the operations console. `version` is the optimistic lock the MCP
-- tools hand back and forth — an update or submit carrying a stale version is refused by
-- the WHERE clause, resolved in the database rather than in application code.
--
-- Additive: a new table plus two indexes, so it applies while the previous image is serving
-- and changes no existing behaviour (acceptance: web, schedulers, API v1 and social are
-- unaffected).

CREATE TABLE "McpPublicationDraft" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "institutionSlug" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "sourcePublishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validationIssues" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpPublicationDraft_pkey" PRIMARY KEY ("id")
);

-- The own-drafts listing (creator, state, newest first) and the review queue's view of
-- everything that has been submitted.
CREATE INDEX "McpPublicationDraft_createdById_status_updatedAt_idx" ON "McpPublicationDraft"("createdById", "status", "updatedAt");
CREATE INDEX "McpPublicationDraft_status_submittedAt_idx" ON "McpPublicationDraft"("status", "submittedAt");

ALTER TABLE "McpPublicationDraft" ADD CONSTRAINT "McpPublicationDraft_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
