-- Founding membership: the first hundred registered accounts, numbered 1..100. A unique
-- column rather than a counter, so the cap holds even if two people register at the same
-- moment. Existing rows stay NULL until the backfill assigns seats in registration order.
ALTER TABLE "User" ADD COLUMN "foundingSeat" INTEGER;
CREATE UNIQUE INDEX "User_foundingSeat_key" ON "User"("foundingSeat");
