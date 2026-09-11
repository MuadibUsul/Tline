import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_HEARTBEAT_MS = 120_000;
const STALE_JOB_MS = 20 * 60_000;

/** Constant-time compare for the monitoring token; lengths differ, so guard that first. */
function tokenMatches(presented: string | null): boolean {
  const expected = process.env.HEALTH_DETAIL_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Detail is gated: job errors, provider names and sync states describe internal
 * infrastructure and have no business reaching an anonymous caller. The unauthenticated
 * body is the bare rollup that container healthchecks and uptime probes actually need.
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (tokenMatches(bearer)) return true;
  return can(await getSessionUser(), "admin.review");
}

export async function GET(request: Request) {
  try {
    const now = new Date();
    const staleHeartbeatBefore = new Date(now.getTime() - STALE_HEARTBEAT_MS);
    const staleJobBefore = new Date(now.getTime() - STALE_JOB_MS);

    await prisma.$queryRawUnsafe("SELECT 1");
    getDocumentStorage();

    const [workers, staleJobs] = await Promise.all([
      prisma.workerHeartbeat.findMany({ orderBy: { name: "asc" } }),
      prisma.jobRun.count({ where: { status: "running", startedAt: { lt: staleJobBefore } } }),
    ]);

    const workerHealth = Object.fromEntries(["research", "macro", "social"].map((name) => {
      const worker = workers.find((item) => item.name === name);
      const healthy = worker?.status === "running" && worker.lastSeenAt >= staleHeartbeatBefore;
      return [name, { status: healthy ? "ok" : "stale", lastSeenAt: worker?.lastSeenAt ?? null }];
    }));
    const status = staleJobs > 0 || Object.values(workerHealth).some((worker) => worker.status !== "ok")
      ? "degraded"
      : "ok";

    const headers = { "cache-control": "no-store" };
    if (!await isAuthorized(request)) return Response.json({ status }, { headers });

    const crawlableWhere = { crawlPolicy: { in: ["allowed", "delayed"] }, monitoringEnabled: true };
    const [crawlable, statuses, recentSuccess, dueSources, schedule, latestIngest, macroJobs, macroStates] =
      await Promise.all([
        prisma.institution.count({ where: crawlableWhere }),
        prisma.institution.groupBy({ by: ["lastCrawlStatus"], where: crawlableWhere, _count: { _all: true } }),
        prisma.institution.count({
          where: { ...crawlableWhere, lastSuccessAt: { gte: new Date(now.getTime() - 864e5) } },
        }),
        prisma.institution.count({
          where: { ...crawlableWhere, OR: [{ nextCrawlAt: null }, { nextCrawlAt: { lte: now } }] },
        }),
        prisma.institution.aggregate({
          where: crawlableWhere,
          _min: { nextCrawlAt: true },
          _max: { lastDiscoveredAt: true },
        }),
        prisma.jobRun.findFirst({ where: { name: "ingest" }, orderBy: { startedAt: "desc" } }),
        prisma.jobRun.findMany({
          where: { name: { startsWith: "macro:" } },
          distinct: ["name"],
          orderBy: [{ name: "asc" }, { startedAt: "desc" }],
        }),
        prisma.macroSyncState.findMany({
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: { provider: true, scopeKey: true, lastStatus: true, lastSuccessAt: true, lastError: true },
        }),
      ]);

    const parseMetrics = (raw: string | null) => {
      try { return JSON.parse(raw || "{}"); } catch { return {}; }
    };

    return Response.json({
      status,
      database: "ok",
      storage: "configured",
      workers: workerHealth,
      staleRunningJobs: staleJobs,
      ingestion: {
        crawlableSources: crawlable,
        recentSuccess24h: recentSuccess,
        dueSources,
        nextCheckAt: schedule._min.nextCrawlAt,
        lastDiscoveredAt: schedule._max.lastDiscoveredAt,
        byStatus: Object.fromEntries(statuses.map((entry) => [entry.lastCrawlStatus ?? "never", entry._count._all])),
        latestRun: latestIngest ? {
          status: latestIngest.status,
          attempt: latestIngest.attempt,
          startedAt: latestIngest.startedAt,
          finishedAt: latestIngest.finishedAt,
          metrics: parseMetrics(latestIngest.metrics),
          error: latestIngest.error,
        } : null,
      },
      macro: {
        status: macroJobs.some((job) => job.status === "failed") ? "degraded" : macroJobs.length ? "ok" : "not_started",
        latestRuns: Object.fromEntries(macroJobs.map((job) => [job.name, {
          status: job.status,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          metrics: parseMetrics(job.metrics),
          error: job.error,
        }])),
        syncStates: macroStates,
      },
    }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
