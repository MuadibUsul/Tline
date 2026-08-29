import type { Prisma } from "@prisma/client";

/** Public pages expose only articles whose complete bilingual delivery package is ready. */
export function publicationReadyWhere(extra?: Prisma.ArticleWhereInput): Prisma.ArticleWhereInput {
  const ready: Prisma.ArticleWhereInput = {
    rawText: { not: null },
    analysis: { is: { reviewStatus: "ok" } },
    documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } },
    translations: {
      some: {
        locale: "zh-CN",
        status: "reviewed",
        documents: { some: { kind: "translation_pdf", locale: "zh-CN", status: "ready" } },
      },
    },
  };
  return extra ? { AND: [ready, extra] } : ready;
}
