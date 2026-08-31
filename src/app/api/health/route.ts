import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    getDocumentStorage();
    const crawlableWhere = { crawlPolicy: { in: ["allowed", "delayed"] }, monitoringEnabled: true };
    const [crawlable, statuses, recentSuccess, dueSources, schedule, latestIngest, macroJobs, macroStates] = await Promise.all([
      prisma.institution.count({ where: crawlableWhere }),
      prisma.institution.groupBy({
        by: ["lastCrawlStatus"],
        where: crawlableWhere,
        _count: { _all: true },
      }),
      prisma.institution.count({
        where: { ...crawlableWhere, lastSuccessAt: { gte: new Date(Date.now() - 864e5) } },
      }),
      prisma.institution.count({
        where: { ...crawlableWhere, OR: [{ nextCrawlAt: null }, { nextCrawlAt: { lte: new Date() } }] },
      }),
      prisma.institution.aggregate({ where: crawlableWhere, _min: { nextCrawlAt: true }, _max: { lastDiscoveredAt: true } }),
      prisma.jobRun.findFirst({ where: { name: "ingest" }, orderBy: { startedAt: "desc" } }),
      prisma.jobRun.findMany({ where: { name: { startsWith: "macro:" } }, distinct: ["name"], orderBy: [{ name: "asc" }, { startedAt: "desc" }] }),
      prisma.macroSyncState.findMany({ orderBy: { updatedAt: "desc" }, take: 50, select: { provider: true, scopeKey: true, lastStatus: true, lastSuccessAt: true, lastError: true } }),
    ]);
    const byStatus = Object.fromEntries(statuses.map((entry) => [entry.lastCrawlStatus ?? "never", entry._count._all]));
    return Response.json({
      status: "ok",
      database: "ok",
      storage: "configured",
      ingestion: {
        crawlableSources: crawlable,
        recentSuccess24h: recentSuccess,
        dueSources,
        nextCheckAt: schedule._min.nextCrawlAt,
        lastDiscoveredAt: schedule._max.lastDiscoveredAt,
        byStatus,
        latestRun: latestIngest ? {
          status: latestIngest.status,
          attempt: latestIngest.attempt,
          startedAt: latestIngest.startedAt,
          finishedAt: latestIngest.finishedAt,
          metrics: JSON.parse(latestIngest.metrics || "{}"),
          error: latestIngest.error,
        } : null,
      },
      macro: {
        status: macroJobs.some((job) => job.status === "failed") ? "degraded" : macroJobs.length ? "ok" : "not_started",
        latestRuns: Object.fromEntries(macroJobs.map((job) => [job.name, {
          status: job.status,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          metrics: (() => { try { return JSON.parse(job.metrics || "{}"); } catch { return {}; } })(),
          error: job.error,
        }])),
        syncStates: macroStates,
      },
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
