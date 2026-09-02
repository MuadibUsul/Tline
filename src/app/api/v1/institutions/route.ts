import { prisma } from "@/lib/db";
import { publicationReadyWhere } from "@/lib/publication";
import { withApiKey } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

// The lookup table behind the `institution` filter on /research.
export const GET = withApiKey("research:read", async () => {
  const rows = await prisma.institution.findMany({
    where: { articles: { some: publicationReadyWhere() } },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      country: true,
      language: true,
      authorityScore: true,
      _count: { select: { articles: true } },
    },
  });
  return {
    data: rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      country: row.country,
      language: row.language,
      authorityScore: row.authorityScore,
      reportCount: row._count.articles,
    })),
  };
});
