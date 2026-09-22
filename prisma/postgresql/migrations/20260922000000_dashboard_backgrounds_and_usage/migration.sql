ALTER TABLE "DashboardTemplate"
ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "DashboardBackground" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DashboardBackground_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardBackground_imageUrl_key" ON "DashboardBackground"("imageUrl");
CREATE INDEX "DashboardBackground_enabled_sortOrder_idx" ON "DashboardBackground"("enabled", "sortOrder");
