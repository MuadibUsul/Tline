import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { newsCadenceLabel } from "@/lib/news";
import ColumnForm from "../ColumnForm";
import { createNewsColumnAction } from "../actions";

export const metadata: Metadata = { title: "新鲜事栏目" };

/** The recurring desks. A column is created once; editions are filed into it by slug. */
export default async function AdminNewsColumnsPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const columns = await prisma.newsColumn.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { posts: true } } },
  });

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Columns", "栏目")}</h1>
          <p className="sub">{tr(locale, "Recurring desks the newsroom files editions under — the daily brief, the weekly note. A column's slug is permanent.", "新鲜事归属的长期栏目：每日简报、每周观察等。栏目 slug 创建后不变。")}</p>
        </div>
        <div className="tag-row"><span className="chip acc">{columns.length}</span></div>
      </header>

      <div className="admin-columns">
        <section className="blk">
          <div className="section-t"><span>{tr(locale, "All columns", "全部栏目")}</span></div>
          <div className="admin-review-list">
            {columns.length === 0 && <div className="empty-state">{tr(locale, "No columns yet — create the first one on the right.", "还没有栏目——在右侧创建第一个。")}</div>}
            {columns.map((column) => (
              <div className="admin-review-row" key={column.id}>
                <Link href={localePath(locale, `/news/columns/${column.slug}`)}>
                  <span>
                    <b>{column.nameZh}{column.nameEn ? ` · ${column.nameEn}` : ""}</b>
                    <small className="mono">{column.slug} · {newsCadenceLabel(column.cadence, locale)} · {column._count.posts} {tr(locale, "editions", "期")}</small>
                  </span>
                  <span className="chip gray">{tr(locale, "View", "查看")} ↗</span>
                </Link>
              </div>
            ))}
          </div>
          <p className="sub" style={{ fontSize: 12, marginTop: 12 }}>
            <Link href={localePath(locale, "/admin/news")}>← {tr(locale, "Back to the newsroom", "返回新鲜事列表")}</Link>
          </p>
        </section>

        <aside>
          <section className="blk">
            <div className="section-t">{tr(locale, "New column", "新建栏目")}</div>
            <ColumnForm
              action={createNewsColumnAction}
              labels={{
                slug: tr(locale, "Slug (lowercase, hyphens)", "Slug（小写字母与连字符）"),
                nameZh: tr(locale, "Chinese name", "中文名称"),
                nameEn: tr(locale, "English name", "英文名称"),
                descriptionZh: tr(locale, "Chinese description", "中文说明"),
                descriptionEn: tr(locale, "English description", "英文说明"),
                cadence: tr(locale, "Cadence", "更新频率"),
                submit: tr(locale, "Create column", "创建栏目"),
                submitting: tr(locale, "Creating…", "创建中……"),
                cadences: {
                  daily: tr(locale, "Daily", "每日更新"),
                  weekly: tr(locale, "Weekly", "每周更新"),
                  monthly: tr(locale, "Monthly", "每月更新"),
                  ongoing: tr(locale, "Ongoing / ad hoc", "长期/不定期"),
                },
              }}
            />
          </section>
        </aside>
      </div>
    </>
  );
}
