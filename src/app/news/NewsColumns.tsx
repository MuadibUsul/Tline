import Link from "next/link";
import { localePath, tr, type Locale } from "@/lib/i18n";
import { newsColumnName, newsDateLabel, type NewsColumnSummary } from "@/lib/news";
import { Icon } from "@/app/_components/Icon";

type Column = NewsColumnSummary & { posts: Array<{ publishedAt: Date | null }> };

export default function NewsColumns({ columns, locale }: { columns: Column[]; locale: Locale }) {
  const groups = [
    { key: "daily", label: tr(locale, "Daily editions", "每日追踪"), columns: columns.filter((column) => column.cadence === "daily") },
    { key: "ongoing", label: tr(locale, "Topics & sources", "专题信源"), columns: columns.filter((column) => column.cadence !== "daily") },
  ];
  const shortDate = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
  });

  return (
    <aside className="news-sidebar" aria-label={tr(locale, "News columns", "快讯栏目")}>
      <div className="news-sidebar-head">
        <h2>{tr(locale, "Browse columns", "栏目导航")}</h2>
        <span>{columns.length.toString().padStart(2, "0")}</span>
      </div>
      <nav className="news-column-nav" aria-label={tr(locale, "News columns", "快讯栏目")}>
        <Link className="news-column-all" href={localePath(locale, "/news")} aria-current="page">
          <span>{tr(locale, "All updates", "全部快讯")}</span>
          <Icon name="arrow-right" />
        </Link>
        {groups.filter((group) => group.columns.length).map((group) => (
          <div className="news-nav-group" key={group.key}>
            <h3>{group.label}</h3>
            <ul>
              {group.columns.map((column) => {
                const latest = column.posts[0]?.publishedAt;
                const name = newsColumnName(column, locale);
                return (
                  <li key={column.slug}>
                    <Link className="news-column-link" href={localePath(locale, `/news/columns/${column.slug}`)} title={name}>
                      <span className="news-column-name">{name}</span>
                      <span className="news-column-meta">
                        {latest && <time dateTime={latest.toISOString()} title={newsDateLabel(latest, locale)}>{shortDate.format(latest)}</time>}
                        <span className="news-column-count" aria-label={tr(locale, `${column.posts.length} editions`, `${column.posts.length} 期`)}>{column.posts.length}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
