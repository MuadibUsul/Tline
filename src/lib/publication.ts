import type { Prisma } from "@prisma/client";

/** Prefer the institution's PDF; generated English copies are only for HTML sources. */
export function preferredEnglishDocuments<T extends { kind: string }>(documents: T[]): T[] {
  const native = documents.filter((document) => document.kind === "source_native");
  return native.length ? native : documents.filter((document) => document.kind === "original_pdf");
}

/** Public pages expose articles once their complete source text and an English source PDF are ready. */
export function publicationReadyWhere(extra?: Prisma.ArticleWhereInput): Prisma.ArticleWhereInput {
  const ready: Prisma.ArticleWhereInput = {
    rawText: { not: null },
    OR: [
      { documents: { some: { kind: "source_native", locale: "en", status: "ready" } } },
      { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
    ],
  };
  return extra ? { AND: [ready, extra] } : ready;
}
