import { prisma } from "../db";
import type { Window } from "./query";
import { dayKey } from "./identity";

/** The behavior layer behind the page-performance and heat-map views. */

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function rate(part: number, total: number): number | null {
  return total ? (part / total) * 100 : null;
}

export interface BehaviorOverview {
  views: number;
  visitors: number;
  glances: number;
  reads: number;
  glanceRate: number | null;
  readRate: number | null;
  medianVisibleSec: number | null;
  medianScrollPct: number | null;
  exits: number;
  clickEvents: number;
}

export async function behaviorOverview(window: Window): Promise<BehaviorOverview> {
  const where = { ts: { gte: window.from, lte: window.to } };
  const [rows, clicks] = await Promise.all([
    prisma.pageView.findMany({
      where,
      select: { visitorId: true, visitorKey: true, visibleMs: true, maxScrollPct: true, isGlance: true, isRead: true, isExit: true },
    }),
    prisma.clickEvent.count({ where }),
  ]);
  const visitors = new Set(rows.map((row) => row.visitorKey ?? `d:${row.visitorId}`)).size;
  const glances = rows.filter((row) => row.isGlance).length;
  const reads = rows.filter((row) => row.isRead).length;
  return {
    views: rows.length,
    visitors,
    glances,
    reads,
    glanceRate: rate(glances, rows.length),
    readRate: rate(reads, rows.length),
    medianVisibleSec: (() => { const value = median(rows.flatMap((row) => row.visibleMs === null ? [] : [row.visibleMs])); return value === null ? null : value / 1000; })(),
    medianScrollPct: median(rows.flatMap((row) => row.maxScrollPct === null ? [] : [row.maxScrollPct])),
    exits: rows.filter((row) => row.isExit).length,
    clickEvents: clicks,
  };
}

export interface PagePerformance {
  path: string;
  template: string | null;
  views: number;
  visitors: number;
  glances: number;
  reads: number;
  glanceRate: number | null;
  readRate: number | null;
  medianVisibleSec: number | null;
  medianScrollPct: number | null;
  exits: number;
  exitRate: number | null;
  clicks: number;
}

/** Per-page reading quality, ranked by views. */
export async function pagePerformance(window: Window, limit = 50): Promise<PagePerformance[]> {
  const where = { ts: { gte: window.from, lte: window.to } };
  const [rows, clickRows] = await Promise.all([
    prisma.pageView.findMany({
      where,
      select: {
        path: true, template: true, visitorId: true, visitorKey: true, visibleMs: true, maxScrollPct: true,
        isGlance: true, isRead: true, isExit: true,
      },
    }),
    prisma.clickEvent.groupBy({ by: ["path"], where, _count: { _all: true } }),
  ]);
  const clicks = new Map(clickRows.map((row) => [row.path, row._count._all]));
  const byPath = new Map<string, {
    template: string | null; visitors: Set<string>; views: number; glances: number; reads: number;
    visible: number[]; scroll: number[]; exits: number;
  }>();
  for (const row of rows) {
    const bucket = byPath.get(row.path) ?? {
      template: row.template, visitors: new Set<string>(), views: 0, glances: 0, reads: 0, visible: [], scroll: [], exits: 0,
    };
    bucket.views += 1;
    bucket.visitors.add(row.visitorKey ?? `d:${row.visitorId}`);
    if (row.isGlance) bucket.glances += 1;
    if (row.isRead) bucket.reads += 1;
    if (row.visibleMs !== null) bucket.visible.push(row.visibleMs);
    if (row.maxScrollPct !== null) bucket.scroll.push(row.maxScrollPct);
    if (row.isExit) bucket.exits += 1;
    byPath.set(row.path, bucket);
  }
  return [...byPath.entries()]
    .map(([path, bucket]) => {
      const visible = median(bucket.visible);
      return {
        path,
        template: bucket.template,
        views: bucket.views,
        visitors: bucket.visitors.size,
        glances: bucket.glances,
        reads: bucket.reads,
        glanceRate: rate(bucket.glances, bucket.views),
        readRate: rate(bucket.reads, bucket.views),
        medianVisibleSec: visible === null ? null : visible / 1000,
        medianScrollPct: median(bucket.scroll),
        exits: bucket.exits,
        exitRate: rate(bucket.exits, bucket.views),
        clicks: clicks.get(path) ?? 0,
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export interface ScrollBucket {
  label: string;
  views: number;
  share: number | null;
}

export async function scrollDistribution(window: Window): Promise<ScrollBucket[]> {
  const rows = await prisma.pageView.findMany({
    where: { ts: { gte: window.from, lte: window.to }, maxScrollPct: { not: null } },
    select: { maxScrollPct: true },
  });
  const buckets = Array.from({ length: 10 }, (_, index) => ({ label: `${index * 10}–${index * 10 + 10}%`, views: 0 }));
  for (const row of rows) {
    const index = Math.min(9, Math.max(0, Math.floor((row.maxScrollPct ?? 0) / 10)));
    buckets[index].views += 1;
  }
  return buckets.map((bucket) => ({ ...bucket, share: rate(bucket.views, rows.length) }));
}

export interface SectionHeat {
  path: string;
  section: string;
  title: string | null;
  views: number;
  visibleSec: number;
  avgVisibleSec: number | null;
  maxVisiblePct: number | null;
  exits: number;
  exitRate: number | null;
}

/** Which blocks held attention, and which blocks were where readers left. */
export async function sectionHeat(window: Window, limit = 40): Promise<SectionHeat[]> {
  const where = { ts: { gte: window.from, lte: window.to } };
  const [rows, exits] = await Promise.all([
    prisma.sectionView.groupBy({
      by: ["path", "section", "sectionTitle"],
      where,
      _sum: { visibleMs: true },
      _avg: { maxVisiblePct: true },
      _count: { _all: true },
    }),
    prisma.sectionView.groupBy({ by: ["path", "section"], where: { ...where, isExit: true }, _count: { _all: true } }),
  ]);
  const exitMap = new Map(exits.map((row) => [`${row.path}\u0000${row.section}`, row._count._all]));
  return rows.map((row) => {
    const sectionExits = exitMap.get(`${row.path}\u0000${row.section}`) ?? 0;
    return {
      path: row.path,
      section: row.section,
      title: row.sectionTitle,
      views: row._count._all,
      visibleSec: Math.round((row._sum.visibleMs ?? 0) / 1000),
      avgVisibleSec: row._count._all ? Math.round(((row._sum.visibleMs ?? 0) / row._count._all) / 100) / 10 : null,
      maxVisiblePct: row._avg.maxVisiblePct === null ? null : Math.round(row._avg.maxVisiblePct),
      exits: sectionExits,
      exitRate: rate(sectionExits, row._count._all),
    };
  }).sort((a, b) => b.visibleSec - a.visibleSec).slice(0, limit);
}

export interface ClickTarget {
  path: string;
  targetPath: string | null;
  label: string | null;
  type: string;
  count: number;
}

export async function clickTargets(window: Window, limit = 30): Promise<ClickTarget[]> {
  const rows = await prisma.clickEvent.groupBy({
    by: ["path", "targetPath", "targetLabel", "targetType"],
    where: { ts: { gte: window.from, lte: window.to } },
    _count: { _all: true },
    orderBy: { _count: { path: "desc" } },
    take: limit,
  });
  return rows.map((row) => ({
    path: row.path,
    targetPath: row.targetPath,
    label: row.targetLabel,
    type: row.targetType,
    count: row._count._all,
  }));
}

export interface FlowRow {
  from: string;
  to: string;
  count: number;
}

/** Where readers went next, from the transition beacon rather than a click guess. */
export async function pageFlow(window: Window, limit = 25): Promise<FlowRow[]> {
  const rows = await prisma.pageView.groupBy({
    by: ["path", "nextPath"],
    where: { ts: { gte: window.from, lte: window.to }, nextPath: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { path: "desc" } },
    take: limit,
  });
  return rows.flatMap((row) => row.nextPath ? [{ from: row.path, to: row.nextPath, count: row._count._all }] : []);
}

export interface LoyalAnonymous {
  visitors: number;
  thresholdDays: number;
  views: number;
  topPages: { path: string; views: number }[];
  topTemplates: { template: string; views: number }[];
}

/**
 * Readers with a stable cookie who came back on many days without signing in.
 *
 * The threshold scales with the selected window: 4 days in a week, 8 in a month, 12 in a
 * quarter. Cookieless readers cannot enter this segment by construction; the dashboard
 * says so instead of silently shrinking the number.
 */
export async function loyalAnonymous(window: Window): Promise<LoyalAnonymous> {
  const thresholdDays = window.days <= 1 ? 1 : window.days <= 7 ? 4 : window.days <= 30 ? 8 : window.days <= 90 ? 12 : 20;
  if (window.days <= 1) return { visitors: 0, thresholdDays, views: 0, topPages: [], topTemplates: [] };
  const rows = await prisma.pageView.groupBy({
    by: ["visitorKey", "day"],
    where: { ts: { gte: window.from, lte: window.to }, visitorKey: { not: null }, userId: null },
    _count: { _all: true },
  });
  const byVisitor = new Map<string, { days: Set<string>; views: number }>();
  for (const row of rows) {
    if (!row.visitorKey) continue;
    const bucket = byVisitor.get(row.visitorKey) ?? { days: new Set<string>(), views: 0 };
    bucket.days.add(row.day);
    bucket.views += row._count._all;
    byVisitor.set(row.visitorKey, bucket);
  }
  const keys = [...byVisitor.entries()].filter(([, bucket]) => bucket.days.size >= thresholdDays);
  if (!keys.length) return { visitors: 0, thresholdDays, views: 0, topPages: [], topTemplates: [] };
  const keySet = new Set(keys.map(([key]) => key));
  const detail = await prisma.pageView.findMany({
    where: { ts: { gte: window.from, lte: window.to }, visitorKey: { in: [...keySet] }, userId: null },
    select: { path: true, template: true },
  });
  const pages = new Map<string, number>();
  const templates = new Map<string, number>();
  for (const row of detail) {
    pages.set(row.path, (pages.get(row.path) ?? 0) + 1);
    if (row.template) templates.set(row.template, (templates.get(row.template) ?? 0) + 1);
  }
  const top = (map: Map<string, number>) => [...map.entries()].map(([value, views]) => ({ value, views })).sort((a, b) => b.views - a.views).slice(0, 8);
  return {
    visitors: keys.length,
    thresholdDays,
    views: detail.length,
    topPages: top(pages).map((row) => ({ path: row.value, views: row.views })),
    topTemplates: top(templates).map((row) => ({ template: row.value, views: row.views })),
  };
}

export interface TrafficQualityRow {
  trafficClass: string;
  agentName: string;
  count: number;
}

export interface TrafficQuality {
  humanViews: number;
  botHits: number;
  byClass: { trafficClass: string; count: number }[];
  agents: TrafficQualityRow[];
  paths: { path: string; count: number; trafficClass: string }[];
}

/** Human traffic from PageView, and requests from crawler/agent/automation sources. */
export async function trafficQuality(window: Window, limit = 20): Promise<TrafficQuality> {
  const day = dayKey(window.from);
  const [humanViews, botRows, botPaths] = await Promise.all([
    prisma.pageView.count({ where: { ts: { gte: window.from, lte: window.to } } }),
    prisma.botHitDaily.groupBy({
      by: ["trafficClass", "agentName"],
      where: { day: { gte: day } },
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: limit,
    }),
    prisma.botHitDaily.groupBy({
      by: ["path", "trafficClass"],
      where: { day: { gte: day } },
      _sum: { count: true },
      orderBy: { _sum: { count: "desc" } },
      take: limit,
    }),
  ]);
  const agents = botRows.map((row) => ({ trafficClass: row.trafficClass, agentName: row.agentName, count: row._sum.count ?? 0 }));
  const byClassMap = new Map<string, number>();
  for (const row of agents) byClassMap.set(row.trafficClass, (byClassMap.get(row.trafficClass) ?? 0) + row.count);
  return {
    humanViews,
    botHits: agents.reduce((total, row) => total + row.count, 0),
    byClass: [...byClassMap.entries()].map(([trafficClass, count]) => ({ trafficClass, count })).sort((a, b) => b.count - a.count),
    agents,
    paths: botPaths.map((row) => ({ path: row.path, trafficClass: row.trafficClass, count: row._sum.count ?? 0 })),
  };
}
