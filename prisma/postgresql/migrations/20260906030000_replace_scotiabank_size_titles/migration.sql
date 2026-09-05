-- These rows are failed embedded-PDF imports: the download size was stored as the title
-- and a separate canonical HTML article already exists for the same edition. Remove only
-- Scotiabank's unmistakable size-only records; the seven-day source pass immediately
-- rebuilds each edition in place under its canonical page URL and native PDF attachment.
DELETE FROM "Article"
WHERE "institutionId" = (SELECT "id" FROM "Institution" WHERE "slug" = 'scotiabank')
  AND "title" ~ '^[0-9]+(\.[0-9]+)?[[:space:]]*(KB|MB|GB)$';
