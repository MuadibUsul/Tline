import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { noIndex } from "@/lib/seo";
import { getSessionUser } from "@/lib/auth";
import { listBookmarkedArticles } from "@/lib/bookmarks";
import { getLocale, institutionName, localePath, localizeChineseContent, tr } from "@/lib/i18n";
import { researchPath } from "@/lib/researchPath";
import { relTime } from "@/app/_components/ui";

export const dynamic = "force-dynamic";

// Behind a sign-in: robots.txt asks a crawler not to fetch this, which does not keep
// it out of an index if something links to it. This does.
export const metadata: Metadata = { title: "Bookmarks", ...noIndex };

export default async function BookmarksPage() {
  // Checked before the query runs: an anonymous visitor has no list to load.
  const user = await getSessionUser();
  if (!user) redirect("/signin?next=/account/bookmarks");
  const locale = await getLocale();
  const bookmarks = await listBookmarkedArticles(user.id, locale);

  return (
    <main className="wrap" style={{ maxWidth: 860 }}>
      <div className="page-head" style={{ borderBottom: "none" }}>
        <div className="eyebrow">{tr(locale, "Account", "账户")}</div>
        <h1>{tr(locale, "My bookmarks", "我的收藏")}</h1>
        <p className="sub text-muted">
          {tr(
            locale,
            "Reports you saved, newest first. A report that is no longer published leaves the list, so every link here opens.",
            "已收藏的研报，按收藏时间倒序。文章撤下后会自动从列表中移除，列表中的链接都可以打开。",
          )}
        </p>
      </div>

      {bookmarks.length === 0 ? (
        <div className="empty-state">
          {tr(locale, "Nothing saved yet.", "还没有收藏任何文章。")}{" "}
          <Link href={localePath(locale, "/research")}>{tr(locale, "Browse research", "浏览研报")} →</Link>
        </div>
      ) : (
        <section className="blk">
          <div className="rowlist">
            {bookmarks.map((article) => (
              <Link key={article.id} href={localePath(locale, researchPath(article))}>
                <span>
                  {institutionName(article.institution.name, locale)} ·{" "}
                  {locale === "zh-CN" && article.translations[0]
                    ? localizeChineseContent(article.translations[0].title)
                    : article.title}
                </span>
                <time
                  className="mono"
                  dateTime={article.bookmarkedAt.toISOString()}
                  style={{ whiteSpace: "nowrap", color: "var(--muted)" }}
                >
                  {tr(locale, "Saved", "收藏于")} {relTime(article.bookmarkedAt, locale)}
                </time>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
