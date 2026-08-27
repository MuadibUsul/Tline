ALTER TABLE "Analysis" ADD COLUMN "summaryZh" TEXT;
ALTER TABLE "Analysis" ADD COLUMN "keyArgumentsZh" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Analysis" ADD COLUMN "keyNumbersZh" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Analysis" ADD COLUMN "risksZh" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Analysis" ADD COLUMN "interpretationZh" TEXT;
