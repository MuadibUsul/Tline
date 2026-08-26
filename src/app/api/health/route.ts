import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    getDocumentStorage();
    return Response.json({ status: "ok", database: "ok", storage: "configured" }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ status: "unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
