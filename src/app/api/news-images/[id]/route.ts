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
  const row = await prisma.newsImage.findUnique({ where: { id }, select: { data: true, mimeType: true, thumbData: true, thumbMimeType: true } });
  if (!row) return new Response("Not Found", { status: 404 });
  const thumb = new URL(_request.url).searchParams.get("variant") === "thumb" && row.thumbData && row.thumbMimeType;
  const body = thumb ? row.thumbData! : row.data;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": thumb ? row.thumbMimeType! : row.mimeType,
      "content-length": String(body.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, noimageindex, nofollow",
    },
  });
}
