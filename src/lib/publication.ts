import type { Prisma } from "@prisma/client";

/** Public pages expose articles once their complete source text and English PDF are ready. */
export function publicationReadyWhere(extra?: Prisma.ArticleWhereInput): Prisma.ArticleWhereInput {
  const ready: Prisma.ArticleWhereInput = {
    rawText: { not: null },
    documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } },
  };
  return extra ? { AND: [ready, extra] } : ready;
}
