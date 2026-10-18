import { prisma } from "../db";
import { dayKey } from "./identity";
import { isInternalPath, normalizePath } from "./path";

export type BotSource = "server" | "beacon";
export type BotClass = "crawler" | "ai_agent" | "automation" | "unknown";

/**
 * A crawler or agent hit, aggregated by day, path, class and agent name.
 *
 * These requests usually never run the beacon, so they cannot live in PageView: counting
 * them as audience would be wrong, and dropping them would leave the largest non-human
 * traffic invisible. One row per day/path/agent keeps a crawl from becoming a million raw
 * rows while still showing which pages the agents actually asked for.
 */
export async function recordBotHit(input: {
  path: unknown;
  trafficClass: string;
  agentName?: string | null;
  source: BotSource;
  now?: Date;
}): Promise<boolean> {
  const page = normalizePath(input.path);
  if (!page || isInternalPath(page.path)) return false;
  const trafficClass: BotClass = input.trafficClass === "crawler" || input.trafficClass === "ai_agent" || input.trafficClass === "automation"
    ? input.trafficClass
    : "unknown";
  const agentName = (input.agentName?.trim() || "unknown").slice(0, 80);
  const now = input.now ?? new Date();
  const day = dayKey(now);
  await prisma.botHitDaily.upsert({
    where: {
      day_path_trafficClass_agentName_source: {
        day,
        path: page.path,
        trafficClass,
        agentName,
        source: input.source,
      },
    },
    create: { day, path: page.path, trafficClass, agentName, source: input.source, count: 1, lastAt: now },
    update: { count: { increment: 1 }, lastAt: now },
  });
  return true;
}
