import { prisma } from "./db";
import { publicationReadyWhere } from "./publication";

/**
 * The publishing houses the directory may name.
 *
 * One query for both the standalone directory and the merged categories hub: a house is
 * listed only when at least one of its reports passed the publication gate, and the count
 * beside it is that same public subset. A directory that counted drafts would advertise
 * numbers no page can show.
 */
export function listPublicInstitutions() {
  return prisma.institution.findMany({
    where: { articles: { some: publicationReadyWhere() } },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      country: true,
      authorityScore: true,
      _count: { select: { articles: { where: publicationReadyWhere() } } },
    },
  });
}
