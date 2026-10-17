-- Keys become copyable from the console, 2026-10-17 (owner decision).
-- The digest continues to authenticate; this column only lets an operator retrieve the
-- full key again. Existing rows stay NULL — a hash cannot be reversed — and are marked
-- "rotate before copying" in the console.

ALTER TABLE "ApiKey" ADD COLUMN "secret" TEXT;
