import { prisma } from "../db";
import { dayRange } from "./identity";
import type { Window } from "./query";

/**
 * The non-human lane.
 *
 * Crawlers and agents are requests, not visitors. They live in their own aggregate table
 * (`BotHitDaily`) so they can be managed without polluting the human page-view numbers;
 * this module is the only consumer the console needs.
 */

export interface BotClassCount {
  trafficClass: string;
  count: number;
}

export interface BotAgentRow {
  trafficClass: string;
  agentName: string;
  source: string;
  count: number;
  lastAt: Date;
}

export interface BotPathRow {
  path: string;
  trafficClass: string;
  count: number;
}

export interface BotDailyRow {
  label: string;
  crawler: number;
  ai_agent: number;
  automation: number;
  unknown: number;
  total: number;
}

export interface BotTraffic {
  total: number;
  humanViews: number;
  server: number;
  beacon: number;
  agentsCount: number;
  activeDays: number;
  firstDay: string | null;
  lastDay: string | null;
  byClass: BotClassCount[];
  agents: BotAgentRow[];
  paths: BotPathRow[];
  daily: BotDailyRow[];
}

export async function botTraffic(window: Window): Promise<BotTraffic> {
  const days = dayRange(window.days, window.to);
  const daySet = new Set(days);
  const [rows, humanViews] = await Promise.all([
    prisma.botHitDaily.findMany({
      where: { day: { in: days } },
      select: { day: true, path: true, trafficClass: true, agentName: true, source: true, count: true, lastAt: true },
    }),
    prisma.pageView.count({
      where: { ts: { gte: window.from, lte: window.to }, NOT: { path: { startsWith: "/admin" } } },
    }),
  ]);

  const classes = new Map<string, number>();
  const agents = new Map<string, BotAgentRow>();
  const paths = new Map<string, BotPathRow>();
  const daily = new Map<string, BotDailyRow>();
  for (const day of days) daily.set(day, { label: day.slice(5), crawler: 0, ai_agent: 0, automation: 0, unknown: 0, total: 0 });
  let total = 0;
  let server = 0;
  let beacon = 0;
  const agentNames = new Set<string>();
  for (const row of rows) {
    if (!daySet.has(row.day)) continue;
    total += row.count;
    if (row.source === "server") server += row.count;
    else beacon += row.count;
    classes.set(row.trafficClass, (classes.get(row.trafficClass) ?? 0) + row.count);
    const agentKey = `${row.trafficClass}\u0000${row.agentName}\u0000${row.source}`;
    const agent = agents.get(agentKey);
    if (agent) {
      agent.count += row.count;
      if (row.lastAt > agent.lastAt) agent.lastAt = row.lastAt;
    } else {
      agents.set(agentKey, { trafficClass: row.trafficClass, agentName: row.agentName, source: row.source, count: row.count, lastAt: row.lastAt });
    }
    agentNames.add(row.agentName);
    const pathKey = `${row.trafficClass}\u0000${row.path}`;
    const path = paths.get(pathKey);
    if (path) path.count += row.count;
    else paths.set(pathKey, { path: row.path, trafficClass: row.trafficClass, count: row.count });
    const bucket = daily.get(row.day);
    if (bucket) {
      bucket.total += row.count;
      if (row.trafficClass === "crawler" || row.trafficClass === "ai_agent" || row.trafficClass === "automation") {
        bucket[row.trafficClass] += row.count;
      } else {
        bucket.unknown += row.count;
      }
    }
  }

  const active = [...daily.entries()].filter(([, row]) => row.total > 0).map(([day]) => day).sort();
  return {
    total,
    humanViews,
    activeDays: active.length,
    firstDay: active[0] ?? null,
    lastDay: active.at(-1) ?? null,
    server,
    beacon,
    agentsCount: agentNames.size,
    byClass: [...classes.entries()].map(([trafficClass, count]) => ({ trafficClass, count })).sort((a, b) => b.count - a.count),
    agents: [...agents.values()].sort((a, b) => b.count - a.count).slice(0, 50),
    paths: [...paths.values()].sort((a, b) => b.count - a.count).slice(0, 30),
    daily: [...daily.values()],
  };
}
