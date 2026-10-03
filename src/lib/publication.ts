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
 *
 * Kept as the record of when that boundary was drawn and as the value the ingest pipeline
 * reports. The rule itself is no longer this date: it is the gate's verdict, which already
 * answers "does this report have a usable Chinese page" for every report, old or new.
 */
export const LOCALE_STRICT_ZH_SINCE = new Date(process.env.LOCALE_STRICT_ZH_SINCE || "2026-09-15T00:00:00Z");

/**
 * Public pages expose articles once their complete source text and an English source PDF
 * are ready, and the publication gate admits them at an address.
 *
 * With no locale, the report has to be public *somewhere* — one of the two languages has to
 * have a page, or there is nothing to link to and nothing to read. That is the default because
 * every caller of this function is a public surface: consensus, alerts, the read API, search,
 * a personal watchlist. A report the gate withholds in both languages is not a published
 * report, and letting it contribute to a score or appear in a result list is how a reader ends
 * up at a 404 from inside the site.
 *
 * With a locale, the report has to be public *in that language*, which is the stricter and
 * more obvious requirement for a listing that links to addresses in that language. This used
 * to ask a weaker question — "is there a translation row, or was the report first seen before
 * `LOCALE_STRICT_ZH_SINCE`" — while the page asked `contentQuality`. The two disagreed in the
 * direction that hurts: a /zh listing advertised a report whose Chinese page the page then
 * answered with a 308 to English, so a reader browsing Chinese was handed English, and an /en
 * listing advertised reports whose own page answers 404.
 *
 * A withdrawn report is excluded here rather than at each call site. Everything public —
 * the report page, the sitemap, RSS, the read API, every hub that lists reports, consensus
 * and alerts — asks this one function, so one clause takes it down in all of them at once
 * and no listing can be missed.
 */
export function publicationReadyWhere(extra?: Prisma.ArticleWhereInput, locale?: Locale): Prisma.ArticleWhereInput {
  const ready: Prisma.ArticleWhereInput = {
    rawText: { not: null },
    withdrawnAt: null,
    OR: [
      { documents: { some: { kind: "source_native", locale: "en", status: "ready" } } },
      { documents: { some: { kind: "original_pdf", locale: "en", status: "ready" } } },
    ],
  };
  const localeGate: Prisma.ArticleWhereInput = locale === "zh-CN"
    ? { indexableZh: true }
    : locale === "en"
      ? { indexableEn: true }
      : { OR: [{ indexableEn: true }, { indexableZh: true }] };
  const clauses = [ready, localeGate, ...(extra ? [extra] : [])];
  return { AND: clauses };
}
