-- A title written for search rather than for the page heading.
--
-- Publisher titles are written for someone who already has the PDF open: "The Commodities
-- Feed", "EcoWeek 2", "Fixed Income · 2026 Italian Government Issuance". They name the
-- series, not the subject, so a search engine has nothing to match a query against. This
-- column holds a title that leads with what the report is about. The publisher's own title
-- still heads the page — attribution does not change because search needs something else.
ALTER TABLE "Analysis" ADD COLUMN "seoTitle" TEXT;
