import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newsPublishStats, newsReadCounts, siteReadTotals } from "./news";

const OLD = "1999-01-01";

async function clear() {
  await prisma.newsPost.deleteMany();
  await prisma.pageView.deleteMany();
}

test("newsPublishStats counts published/drafts by kind and day", async () => {
  await clear();
  await prisma.newsPost.createMany({
    data: [
      { slug: "a", kind: "flash", status: "published", publishedAt: new Date() },
      { slug: "b", kind: "flash", status: "published", publishedAt: new Date() },
      { slug: "c", kind: "brief", status: "published", publishedAt: new Date() },
      { slug: "d", kind: "article", status: "draft" },
    ],
  });
  const stats = await newsPublishStats();
  assert.equal(stats.total, 4);
  assert.equal(stats.published, 3);
  assert.equal(stats.drafts, 1);
  assert.equal(stats.byKind.find((k) => k.kind === "flash")?.count, 2);
  assert.equal(stats.byKind.find((k) => k.kind === "brief")?.count, 1);
  assert.equal(stats.byDay[stats.byDay.length - 1].count, 3);
});

test("newsReadCounts counts only human news_article views and reads", async () => {
  await clear();
  await prisma.pageView.createMany({
    data: [
      // human views of slug "a": one read, one not
      { path: "/news/a", visitorId: "v1", sessionId: "s1", template: "news_article", contentId: "a", trafficClass: "human", isRead: true, day: OLD },
      { path: "/news/a", visitorId: "v2", sessionId: "s2", template: "news_article", contentId: "a", trafficClass: "human", isRead: false, day: OLD },
      // a crawler view must not count
      { path: "/news/a", visitorId: "v3", sessionId: "s3", template: "news_article", contentId: "a", trafficClass: "crawler", isRead: true, day: OLD },
      // a different article must not leak into "a"
      { path: "/news/b", visitorId: "v4", sessionId: "s4", template: "news_article", contentId: "b", trafficClass: "human", isRead: true, day: OLD },
    ],
  });
  const counts = await newsReadCounts(["a", "b"]);
  assert.deepEqual(counts["a"], { views: 2, reads: 1 });
  assert.deepEqual(counts["b"], { views: 1, reads: 1 });
});

test("siteReadTotals counts only human views across the site", async () => {
  await clear();
  await prisma.pageView.createMany({
    data: [
      { path: "/", visitorId: "v1", sessionId: "s1", trafficClass: "human", day: OLD, ts: new Date("1999-01-01") },
      { path: "/", visitorId: "v2", sessionId: "s2", trafficClass: "human", day: OLD, ts: new Date("1999-01-01") },
      { path: "/", visitorId: "v3", sessionId: "s3", trafficClass: "crawler", day: OLD, ts: new Date("1999-01-01") },
    ],
  });
  const totals = await siteReadTotals(new Date("2000-01-02"));
  assert.equal(totals.total, 2);
  assert.equal(totals.sevenDay, 0); // rows are from 1999, outside 7d window
  assert.equal(totals.thirtyDay, 0);
});
