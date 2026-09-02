import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { researchInclude, serializeResearch } from "@/lib/apiSerialize";
import { ApiRequestError, withApiKey } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

export const GET = withApiKey("research:read", async (request) => {
  const id = new URL(request.url).pathname.split("/").pop() ?? "";
  const article = await prisma.article.findFirst({
    where: publicationReadyWhere({ id }),
    include: researchInclude,
  });
  // An unpublished report is reported as absent rather than forbidden: whether a given id
  // exists but is still being processed is not the caller's business.
  if (!article) throw new ApiRequestError("not_found", "No published report with that id.", 404);
  return { data: serializeResearch(article) };
});
