-- An operator withdrawal: the report stops being public everywhere the site publishes,
-- and setting the column back to null restores it. Nullable and additive, so existing rows
-- are unaffected and the migration is safe to apply while the previous image is serving.
ALTER TABLE "Article"
ADD COLUMN "withdrawnAt" TIMESTAMP(3);

CREATE INDEX "Article_withdrawnAt_idx" ON "Article"("withdrawnAt");
