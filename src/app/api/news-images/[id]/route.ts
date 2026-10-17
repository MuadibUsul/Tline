import { prisma } from "@/lib/db";

/**
 * The newsroom's images, served by id from the database.
 *
 * A news item is original editorial work, so its figures live with the post rather than in
 * the research figure store or in a bucket. The id is unguessable and the response is
 * noindexed; the digest never changes, so it is safe to cache for a year.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await prisma.newsImage.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!row) return new Response("Not Found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "content-type": row.mimeType,
      "content-length": String(row.data.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-robots-tag": "noindex, noimageindex, nofollow",
    },
  });
}
