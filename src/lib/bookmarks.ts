import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { publicationReadyWhere } from "@/lib/publication";
import type { Locale } from "@/lib/i18n";

/**
 * A reader's saved reports.
 *
 * The table is private to the account: nothing public reads it, and saving a report never
 * changes whether that report is published. The rule that bites at read time is the reverse
 * of that one — a report the publication gate no longer admits must not resurface in a
 * bookmark list — so the list asks `publicationReadyWhere` for every row it is about to
 * link, exactly as every other listing on the site does.
 */

/** Toggling on its own, so the rule is readable and testable without a database. */
export function nextBookmarkState(exists: boolean): { bookmarked: boolean } {
  return { bookmarked: !exists };
}

export interface BookmarkRow {
  articleId: string;
  createdAt: Date;
}

/**
 * Puts fetched articles back into the order their bookmarks were saved — newest first — and
 * carries each bookmark's own timestamp onto the article it names.
 *
 * A bookmark with no fetched article is dropped rather than rendered. The bookmark itself
 * survives (it is still there if the report returns), but a report the gate withholds has no
 * page to link to, and a bookmark list must not advertise an address that answers 404.
 */
export function orderBookmarkedArticles<T extends { id: string }>(
  articles: T[],
  bookmarks: readonly BookmarkRow[],
): Array<T & { bookmarkedAt: Date }> {
  const byId = new Map(articles.map((article) => [article.id, article]));
  return bookmarks.flatMap((bookmark) => {
    const article = byId.get(bookmark.articleId);
    return article ? [{ ...article, bookmarkedAt: bookmark.createdAt }] : [];
  });
}

/**
 * Saves a report, or unsaves one that is already saved.
 *
 * Read and write share one transaction, so two taps on the same button cannot both see "not
 * saved" and both insert. The unique ([userId, articleId]) constraint is the final word on
 * that race; a request that loses it reports the state the table now holds, which is saved.
 *
 * Each save and unsave is audited once the transaction committed, like the watchlist and
 * alert mutations in `src/app/actions.ts`; `locale` records which language surface the
 * reader saved from — the sort of detail a "my bookmark is missing" report needs.
 */
export async function toggleBookmark(userId: string, articleId: string, locale: Locale): Promise<{ bookmarked: boolean }> {
  const state = await prisma
    .$transaction(async (tx) => {
      const existing = await tx.articleBookmark.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { id: true },
      });
      if (existing) {
        // deleteMany rather than delete: a concurrent request may have removed the row
        // between this read and this write, and "already gone" is success here.
        await tx.articleBookmark.deleteMany({ where: { userId, articleId } });
        return nextBookmarkState(true);
      }
      await tx.articleBookmark.create({ data: { userId, articleId } });
      return nextBookmarkState(false);
    })
    .catch((error) => {
      // Another request inserted the same bookmark between this one's read and its write.
      // The constraint settled the race in favour of "saved", and that is the honest answer
      // to give this one too.
      if ((error as { code?: string }).code === "P2002") return { bookmarked: true };
      throw error;
    });
  await writeAudit({
    actorId: userId,
    action: state.bookmarked ? "bookmark.create" : "bookmark.delete",
    targetType: "article",
    targetId: articleId,
    metadata: { locale },
  });
  return state;
}

/** Every saved article id, newest first — what a report page needs to render its button. */
export async function listBookmarkIds(userId: string): Promise<string[]> {
  const rows = await prisma.articleBookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { articleId: true },
  });
  return rows.map((row) => row.articleId);
}

/** The card's minimum: enough for institution · title · saved-at, and nothing that costs a body read. */
const bookmarkedArticleSelect = {
  id: true,
  slug: true,
  title: true,
  publishedAt: true,
  createdAt: true,
  institution: { select: { slug: true, name: true } },
  analysis: { select: { summary: true, summaryZh: true } },
  translations: { where: { locale: "zh-CN" }, take: 1, select: { title: true } },
} satisfies Prisma.ArticleSelect;

export type BookmarkedArticle = Prisma.ArticleGetPayload<{ select: typeof bookmarkedArticleSelect }> & { bookmarkedAt: Date };

/**
 * The reader's bookmark list, newest save first.
 *
 * Bookmarks are read first so the order (and the limit) is the reader's own; then the
 * articles behind them are fetched through the publication gate and reordered back. The
 * gate is asked in the list's own language because every row links to an address in that
 * language — the same rule the research feed follows.
 */
export async function listBookmarkedArticles(userId: string, locale: Locale, limit = 50): Promise<BookmarkedArticle[]> {
  const bookmarks = await prisma.articleBookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { articleId: true, createdAt: true },
  });
  if (!bookmarks.length) return [];
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere({ id: { in: bookmarks.map((bookmark) => bookmark.articleId) } }, locale),
    select: bookmarkedArticleSelect,
  });
  return orderBookmarkedArticles(articles, bookmarks);
}
