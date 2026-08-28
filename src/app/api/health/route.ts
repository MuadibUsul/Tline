import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    getDocumentStorage();
    const crawlableWhere = { crawlPolicy: { in: ["allowed", "delayed"] } };
    const [crawlable, statuses, recentSuccess, latestIngest] = await Promise.all([
      prisma.institution.count({ where: crawlableWhere }),
      prisma.institution.groupBy({
        by: ["lastCrawlStatus"],
        where: crawlableWhere,
        _count: { _all: true },
      }),
      prisma.institution.count({
        where: { ...crawlableWhere, lastSuccessAt: { gte: new Date(Date.now() - 864e5) } },
      }),
      prisma.jobRun.findFirst({ where: { name: "ingest" }, orderBy: { startedAt: "desc" } }),
    ]);
    const byStatus = Object.fromEntries(statuses.map((entry) => [entry.lastCrawlStatus ?? "never", entry._count._all]));
    return Response.json({
      status: "ok",
      database: "ok",
      storage: "configured",
      ingestion: {
        crawlableSources: crawlable,
        recentSuccess24h: recentSuccess,
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
