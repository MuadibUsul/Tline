-- Audience behavior analytics, 2026-10-18. Existing rows keep the old cookieless
-- identity and are marked human/unknown; new rows gain a stable opt-in cookie key and
-- page/scroll/section/click detail. No address or raw user agent is stored.

ALTER TABLE "PageView"
  ADD COLUMN "visitorKey" TEXT,
  ADD COLUMN "viewId" TEXT,
  ADD COLUMN "isExit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "template" TEXT,
  ADD COLUMN "contentId" TEXT,
  ADD COLUMN "visibleMs" INTEGER,
  ADD COLUMN "activeMs" INTEGER,
  ADD COLUMN "maxScrollPct" INTEGER,
  ADD COLUMN "lastScrollPct" INTEGER,
  ADD COLUMN "scrollStops" TEXT,
  ADD COLUMN "stoppedSection" TEXT,
  ADD COLUMN "exitSection" TEXT,
  ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isGlance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextPath" TEXT,
  ADD COLUMN "trafficClass" TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN "trafficName" TEXT,
  ADD COLUMN "trafficConfidence" DOUBLE PRECISION,
  ADD COLUMN "trafficSignals" TEXT,
  ADD COLUMN "consent" TEXT NOT NULL DEFAULT 'unknown';

CREATE UNIQUE INDEX "PageView_viewId_key" ON "PageView"("viewId");
CREATE INDEX "PageView_day_template_idx" ON "PageView"("day", "template");
CREATE INDEX "PageView_day_trafficClass_idx" ON "PageView"("day", "trafficClass");
CREATE INDEX "PageView_visitorKey_ts_idx" ON "PageView"("visitorKey", "ts");

ALTER TABLE "AnalyticsEvent"
  ADD COLUMN "visitorKey" TEXT,
  ADD COLUMN "viewId" TEXT,
  ADD COLUMN "trafficClass" TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN "consent" TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX "AnalyticsEvent_visitorKey_ts_idx" ON "AnalyticsEvent"("visitorKey", "ts");

ALTER TABLE "WebVital"
  ADD COLUMN "visitorKey" TEXT,
  ADD COLUMN "trafficClass" TEXT NOT NULL DEFAULT 'human';

CREATE TABLE "ClickEvent" (
  "id" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "day" TEXT NOT NULL,
  "viewId" TEXT,
  "visitorId" TEXT NOT NULL,
  "visitorKey" TEXT,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "path" TEXT NOT NULL,
  "section" TEXT,
  "targetPath" TEXT,
  "targetLabel" TEXT,
  "targetType" TEXT NOT NULL DEFAULT 'link',
  "xPct" INTEGER,
  "yPct" INTEGER,
  "scrollPct" INTEGER,
  "trafficClass" TEXT NOT NULL DEFAULT 'human',
  "consent" TEXT NOT NULL DEFAULT 'unknown',
  CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClickEvent_day_path_idx" ON "ClickEvent"("day", "path");
CREATE INDEX "ClickEvent_day_targetPath_idx" ON "ClickEvent"("day", "targetPath");
CREATE INDEX "ClickEvent_viewId_idx" ON "ClickEvent"("viewId");
CREATE INDEX "ClickEvent_visitorKey_ts_idx" ON "ClickEvent"("visitorKey", "ts");

CREATE TABLE "SectionView" (
  "id" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "day" TEXT NOT NULL,
  "viewId" TEXT,
  "visitorId" TEXT NOT NULL,
  "visitorKey" TEXT,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "path" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "sectionTitle" TEXT,
  "visibleMs" INTEGER NOT NULL DEFAULT 0,
  "maxVisiblePct" INTEGER NOT NULL DEFAULT 0,
  "isExit" BOOLEAN NOT NULL DEFAULT false,
  "trafficClass" TEXT NOT NULL DEFAULT 'human',
  "consent" TEXT NOT NULL DEFAULT 'unknown',
  CONSTRAINT "SectionView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SectionView_day_path_section_idx" ON "SectionView"("day", "path", "section");
CREATE INDEX "SectionView_viewId_idx" ON "SectionView"("viewId");
CREATE INDEX "SectionView_visitorKey_ts_idx" ON "SectionView"("visitorKey", "ts");

CREATE TABLE "BotHitDaily" (
  "id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "trafficClass" TEXT NOT NULL,
  "agentName" TEXT NOT NULL DEFAULT 'unknown',
  "source" TEXT NOT NULL DEFAULT 'server',
  "count" INTEGER NOT NULL DEFAULT 0,
  "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotHitDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotHitDaily_day_path_trafficClass_agentName_source_key"
  ON "BotHitDaily"("day", "path", "trafficClass", "agentName", "source");
CREATE INDEX "BotHitDaily_day_trafficClass_idx" ON "BotHitDaily"("day", "trafficClass");
