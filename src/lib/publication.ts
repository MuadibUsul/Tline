import type { Prisma } from "@prisma/client";
import type { Locale } from "./i18n";

/** Prefer the institution's PDF; generated English copies are only for HTML sources. */
export function preferredEnglishDocuments<T extends { kind: string }>(documents: T[]): T[] {
  const native = documents.filter((document) => document.kind === "source_native");
  return native.length ? native : documents.filter((document) => document.kind === "original_pdf");
}

/**
 * When the Chinese-completeness rule starts to bite. A report first seen on or after this
 * instant must be fully translated before it appears on a Chinese page; everything older
 * is grandfathered and shown exactly as before, so existing content is never touched.
 * Set `LOCALE_STRICT_ZH_SINCE` (ISO 8601) to the deployment time to move the boundary.
 */
export const LOCALE_STRICT_ZH_SINCE = new Date(process.env.LOCALE_STRICT_ZH_SINCE || "2026-09-15T00:00:00Z");

/**
 * Public pages expose articles once their complete source text and an English source PDF
 * are ready.
 *
 * Passing a locale narrows that for Chinese: a report discovered after the cutoff must
 * also carry a Chinese translation, so a freshly ingested report never surfaces on /zh in
 * the publisher's English while its translation is still catching up. English is
 * unaffected, and so is anything published before the cutoff.
 */
export function publicationReadyWhere(extra?: Prisma.ArticleWhereInput, locale?: Locale): Prisma.ArticleWhereInput {
  const ready: Prisma.ArticleWhereInput = {
    rawText: { not: null },
    OR: [
      { documents: { some: { kind: "source_native", locale: "en", status: "ready" } } },
      { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
    ],
  };
  const localeGate: Prisma.ArticleWhereInput | null = locale === "zh-CN"
    ? { OR: [{ createdAt: { lt: LOCALE_STRICT_ZH_SINCE } }, { translations: { some: { locale: "zh-CN" } } }] }
    : null;
  const clauses = [ready, ...(localeGate ? [localeGate] : []), ...(extra ? [extra] : [])];
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}
