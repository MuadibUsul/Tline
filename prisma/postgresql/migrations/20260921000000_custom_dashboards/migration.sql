CREATE TABLE "Dashboard" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "templateKey" TEXT,
  "layoutJson" TEXT NOT NULL DEFAULT '[]',
  "wallpaper" TEXT NOT NULL DEFAULT 'grid',
  "wallpaperUrl" TEXT,
  "accent" TEXT NOT NULL DEFAULT '#9e7a42',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AlertRule" ADD COLUMN "dashboardId" TEXT;

CREATE INDEX "Dashboard_userId_updatedAt_idx" ON "Dashboard"("userId", "updatedAt");
CREATE INDEX "AlertRule_dashboardId_active_idx" ON "AlertRule"("dashboardId", "active");

ALTER TABLE "Dashboard" ADD CONSTRAINT "Dashboard_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_dashboardId_fkey"
  FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
