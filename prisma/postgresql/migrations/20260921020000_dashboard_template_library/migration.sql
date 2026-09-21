CREATE TABLE "DashboardTemplate" (
  "id" TEXT NOT NULL,
  "builtinKey" TEXT,
  "sourceDashboardId" TEXT,
  "authorId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "layoutJson" TEXT NOT NULL DEFAULT '[]',
  "wallpaper" TEXT NOT NULL DEFAULT 'grid',
  "wallpaperUrl" TEXT,
  "accent" TEXT NOT NULL DEFAULT '#9e7a42',
  "coverUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sortOrder" INTEGER NOT NULL DEFAULT 1000,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardTemplate_builtinKey_key" ON "DashboardTemplate"("builtinKey");
CREATE UNIQUE INDEX "DashboardTemplate_sourceDashboardId_key" ON "DashboardTemplate"("sourceDashboardId");
CREATE INDEX "DashboardTemplate_status_sortOrder_idx" ON "DashboardTemplate"("status", "sortOrder");
CREATE INDEX "DashboardTemplate_authorId_updatedAt_idx" ON "DashboardTemplate"("authorId", "updatedAt");
ALTER TABLE "DashboardTemplate" ADD CONSTRAINT "DashboardTemplate_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
