CREATE TABLE "HomeAnnouncement" (
  "id" TEXT NOT NULL,
  "labelEn" TEXT NOT NULL DEFAULT 'Announcement',
  "labelZh" TEXT NOT NULL DEFAULT '公告',
  "titleEn" TEXT NOT NULL,
  "titleZh" TEXT NOT NULL,
  "bodyEn" TEXT,
  "bodyZh" TEXT,
  "href" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeAnnouncement_active_sortOrder_idx" ON "HomeAnnouncement"("active", "sortOrder");

INSERT INTO "HomeAnnouncement"
  ("id", "labelEn", "labelZh", "titleEn", "titleZh", "bodyEn", "bodyZh", "href", "active", "sortOrder", "updatedAt")
VALUES
  ('home-mcp-announcement', 'Announcement', '公告',
   'Connect Tlines to your AI workflow', '把 Tlines 接入你的 AI 工作流',
   'Read published institutional research through MCP, with source and date attached.',
   '通过 MCP 读取已发布的机构研报，来源与日期一并保留。',
   '/mcp', true, 10, CURRENT_TIMESTAMP);
