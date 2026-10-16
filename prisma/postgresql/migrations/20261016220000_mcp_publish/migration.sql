-- Direct publishing for the Publisher MCP (owner decision, 2026-10-16).
--
-- Two nullable columns on the draft table; nothing existing changes. `summary` is the
-- agent-supplied one-sentence conclusion that publish stores as the article's Analysis
-- (the public gate requires a summary, and generating one server-side would be an LLM
-- call nobody approved). `publishedArticleId` records which Article the draft became,
-- so a repeated publish is answered with the article instead of creating a second one.

ALTER TABLE "McpPublicationDraft" ADD COLUMN "summary" TEXT;
ALTER TABLE "McpPublicationDraft" ADD COLUMN "publishedArticleId" TEXT;
-- The preview hash lives in a column rather than being recomputed per read: the draft DTO
-- must not fetch every 100 KB body just to answer "what hash would publishing require".
-- Empty on any pre-existing row (there are none at deploy time), and publish falls back
-- to recomputing from the body if it ever meets one that is empty.
ALTER TABLE "McpPublicationDraft" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
