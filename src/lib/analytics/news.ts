import { prisma } from "@/lib/db";

/**
 * News publish KPIs and per-slug read counts, derived from the existing
 * PageView analytics stack (template = "news_article", contentId = slug,
 * trafficClass = "human") — no third-party SDK.
 *
 * Read definition (口径): a "view" is a human page view; a "read" is a view
 * the reader actually consumed (PageView.isRead = visible >= 15s or scroll
 * >= 50%). Both exclude crawlers / AI agents / automation via trafficClass.
 * Bucketing happens in JS because the two database backends spell date
 * truncation differently (same reason as analytics/query.ts).
 */

const HUMAN = { trafficClass: "human" };

export interface NewsPublishStats {
  total: number;
  published: number;
  drafts: number;
  byKind: { kind: string; count: number }[];
  byDay: { day: string; count: number }[];
  byColumn: { column: string | null; count: number }[];
  byAuthor: { author: string | null; count: number }[];
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function newsPublishStats(days = 14): Promise<NewsPublishStats> {
  const posts = await prisma.newsPost.findMany({
    select: { kind: true, status: true, publishedAt: true, columnId: true, createdById: true },
  });

  const byKind = new Map<string, number>();
  const byColumn = new Map<string | null, number>();
  const byAuthor = new Map<string | null, number>();
  let published = 0;
  let drafts = 0;

  // Last `days` UTC days, oldest first.
  const today = new Date();
  const daysList: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    daysList.push(utcDay(new Date(today.getTime() - i * 86_400_000)));
  }
  const byDay = new Map<string, number>(daysList.map((day) => [day, 0]));

  for (const post of posts) {
    if (post.status === "published") {
      published += 1;
      byKind.set(post.kind, (byKind.get(post.kind) ?? 0) + 1);
      byColumn.set(post.columnId, (byColumn.get(post.columnId) ?? 0) + 1);
      byAuthor.set(post.createdById, (byAuthor.get(post.createdById) ?? 0) + 1);
      if (post.publishedAt) {
        const day = utcDay(post.publishedAt);
        if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }
    } else {
      drafts += 1;
    }
  }

  return {
    total: posts.length,
    published,
    drafts,
    byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    byColumn: [...byColumn.entries()].map(([column, count]) => ({ column, count })).sort((a, b) => b.count - a.count),
    byAuthor: [...byAuthor.entries()].map(([author, count]) => ({ author, count })).sort((a, b) => b.count - a.count),
  };
}

export interface NewsReadCount {
  views: number;
  reads: number;
}

export async function newsReadCounts(slugs: string[]): Promise<Record<string, NewsReadCount>> {
  const out: Record<string, NewsReadCount> = {};
  for (const slug of slugs) out[slug] = { views: 0, reads: 0 };
  if (slugs.length === 0) return out;

  const base = { template: "news_article", contentId: { in: slugs }, ...HUMAN };
  const [viewRows, readRows] = await Promise.all([
    prisma.pageView.groupBy({ by: ["contentId"], where: base, _count: { _all: true } }),
    prisma.pageView.groupBy({ by: ["contentId"], where: { ...base, isRead: true }, _count: { _all: true } }),
  ]);
  for (const row of viewRows) {
    if (row.contentId && out[row.contentId]) out[row.contentId].views = row._count._all;
  }
  for (const row of readRows) {
    if (row.contentId && out[row.contentId]) out[row.contentId].reads = row._count._all;
  }
  return out;
}

export interface SiteReadTotals {
  total: number;
  sevenDay: number;
  thirtyDay: number;
}

export async function siteReadTotals(now = new Date()): Promise<SiteReadTotals> {
  const seven = new Date(now.getTime() - 7 * 86_400_000);
  const thirty = new Date(now.getTime() - 30 * 86_400_000);
  const [total, sevenDay, thirtyDay] = await Promise.all([
    prisma.pageView.count({ where: HUMAN }),
    prisma.pageView.count({ where: { ...HUMAN, ts: { gte: seven } } }),
    prisma.pageView.count({ where: { ...HUMAN, ts: { gte: thirty } } }),
  ]);
  return { total, sevenDay, thirtyDay };
}
