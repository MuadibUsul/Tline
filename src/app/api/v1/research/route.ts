import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { researchInclude, serializeResearch } from "@/lib/apiSerialize";
import { ApiRequestError, dateParam, intParam, withApiKey } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

// Newest first with a cursor, so a consumer polling for new research pages backwards
// through what it has not seen instead of re-reading the whole corpus.
export const GET = withApiKey("research:read", async (request) => {
  const url = new URL(request.url);
  const limit = intParam(url, "limit", 50, 200);
  const since = dateParam(url, "since");
  const until = dateParam(url, "until");
  const institution = url.searchParams.get("institution");
  const ticker = url.searchParams.get("ticker");
  const cursor = url.searchParams.get("cursor");

  if (cursor && !(await prisma.article.findUnique({ where: { id: cursor }, select: { id: true } }))) {
    throw new ApiRequestError("invalid_cursor", "'cursor' does not match a known report.");
  }

  const rows = await prisma.article.findMany({
    where: publicationReadyWhere({
      ...(since || until ? { publishedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
      ...(institution ? { institution: { slug: institution } } : {}),
      ...(ticker ? { articleAssets: { some: { asset: { ticker: ticker.toUpperCase() } } } } : {}),
    }),
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: limit + 1, // one extra row answers "is there another page" without a count
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: researchInclude,
  });

  const page = rows.slice(0, limit);
  return {
    data: page.map(serializeResearch),
    nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
  };
});
