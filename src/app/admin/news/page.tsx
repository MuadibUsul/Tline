import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { isNewsKind, NEWS_KIND_LABEL } from "@/lib/news";
import { when } from "@/app/admin/_components/format";
import { newsPublishStats, newsReadCounts } from "@/lib/analytics/news";
import NewsForm from "./NewsForm";
import { createNewsAction, deleteNewsAction, pinNewsAction, publishNewsAction, unpublishNewsAction } from "./actions";

export const metadata: Metadata = { title: "新鲜事" };

/**
 * The newsroom desk: every post the editors have drafted or published, with the lifecycle
 * actions inline, and the create form beside it. Publishing is a button, not a status the
 * form sets — the same separation the research pipeline uses.
 */
export default async function AdminNewsPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const posts = await prisma.newsPost.findMany({ orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 100 });
  const columns = await prisma.newsColumn.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, nameZh: true, nameEn: true } });
  const [stats, readCounts] = await Promise.all([
    newsPublishStats(),
    newsReadCounts(posts.map((post) => post.slug)),
  ]);
  const publishedByKind = (kind: string) => stats.byKind.find((item) => item.kind === kind)?.count ?? 0;
  const last7 = stats.byDay.slice(-7).reduce((sum, item) => sum + item.count, 0);

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Newsroom", "新鲜事")}</h1>
          <p className="sub">
            {tr(locale, "Briefs, flashes and articles published at /news. Each item carries its own permalink and is written in either or both languages.", "发布于 /news 的短讯、快讯与文章。每条有独立链接，可只写一种语言或中英双语。")}
          </p>
        </div>
        <div className="tag-row">
          <span className="chip acc">{posts.length}</span>
          <Link className="chip gray" href={localePath(locale, "/admin/news/columns")}>{tr(locale, "Columns", "栏目")} →</Link>
        </div>
      </header>

      <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "Publishing KPIs", "发布统计")}</span>
        </div>
        <div className="tag-row">
          <span className="chip acc">{stats.published} {tr(locale, "published", "已发布")}</span>
          <span className="chip gray">{stats.drafts} {tr(locale, "drafts", "草稿")}</span>
          <span className="chip gray">{tr(locale, "Flash", "快讯")} {publishedByKind("flash")}</span>
          <span className="chip gray">{tr(locale, "Brief", "短讯")} {publishedByKind("brief")}</span>
          <span className="chip gray">{tr(locale, "Article", "文章")} {publishedByKind("article")}</span>
          <span className="chip gray">7d +{last7}</span>
        </div>
      </section>

      <div className="admin-columns">
        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Posts", "条目")}</span>
            <span className="chip gray">{posts.filter((post) => post.status === "published").length} {tr(locale, "published", "已发布")}</span>
          </div>
          <div className="admin-review-list">
            {posts.length === 0 && <div className="empty-state">{tr(locale, "Nothing written yet — create the first item on the right.", "还没有内容——在右侧创建第一条。")}</div>}
            {posts.map((post) => {
              const kind = isNewsKind(post.kind) ? post.kind : "brief";
              const published = post.status === "published";
              return (
                <div className="admin-review-row" key={post.id}>
                  <Link href={localePath(locale, `/admin/news/${post.id}`)}>
                    <span>
                      <b>{post.titleZh || post.titleEn}</b>
                      <small>
                        {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
                        {" · "}{tr(locale, "created", "创建于")} {when(post.createdAt, locale)}
                        {post.publishedAt ? ` · ${tr(locale, "published", "发布于")} ${when(post.publishedAt, locale)}` : ""}
                      </small>
                    </span>
                    <span className={`chip ${published ? "bull" : "gray"}`}>{published ? tr(locale, "Published", "已发布") : tr(locale, "Draft", "草稿")}</span>
                    {post.pinned ? <span className="chip acc">{tr(locale, "Pinned", "置顶")}</span> : null}
                    {published ? <span className="chip gray">{readCounts[post.slug]?.views ?? 0} {tr(locale, "views", "阅读")}</span> : null}
                  </Link>
                  <form action={publishNewsAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <button className="minibtn p" type="submit" disabled={published}>{tr(locale, "Publish", "发布")}</button>
                  </form>
                  <form action={unpublishNewsAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <button className="minibtn" type="submit" disabled={!published}>{tr(locale, "Unpublish", "下线")}</button>
                  </form>
                  <form action={pinNewsAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <input type="hidden" name="pinned" value={post.pinned ? "0" : "1"} />
                    <button className="minibtn" type="submit">{post.pinned ? tr(locale, "Unpin", "取消置顶") : tr(locale, "Pin", "置顶")}</button>
                  </form>
                  <form action={deleteNewsAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <button className="minibtn danger" type="submit">{tr(locale, "Delete", "删除")}</button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>

        <aside>
          <section className="blk">
            <div className="section-t">{tr(locale, "New item", "新建条目")}</div>
            <NewsForm
              action={createNewsAction}
              columns={columns}
              labels={{
                kind: tr(locale, "Kind", "类型"),
                column: tr(locale, "Column", "栏目"),
                noColumn: tr(locale, "No column (standalone item)", "不归属栏目（独立内容）"),
                titleZh: tr(locale, "Chinese title", "中文标题"),
                titleEn: tr(locale, "English title", "英文标题"),
                bodyZh: tr(locale, "Chinese body", "中文正文"),
                bodyEn: tr(locale, "English body", "英文正文"),
                sourceUrl: tr(locale, "Primary source URL (https)", "主来源链接（https）"),
                sources: tr(locale, "All sources (one HTTPS URL per line)", "全部来源（每行一个 HTTPS 链接）"),
                sourcesHint: tr(locale, "A daily brief may cite the same dashboard every day; sources are display metadata, not a uniqueness key.", "日报每天可以引用同一个数据源；来源只用于展示，不作为唯一键。"),
                save: tr(locale, "Save draft", "保存草稿"),
                saving: tr(locale, "Saving…", "保存中……"),
                hint: tr(locale, "At least one title is required; a flash may have no body. Blank lines separate paragraphs. Publishing happens from the list.", "至少需要一种语言的标题；快讯可以只有标题。空行分段；发布在列表中操作。"),
                kinds: { article: tr(locale, "Article", "文章"), brief: tr(locale, "Brief", "短讯"), flash: tr(locale, "Flash", "快讯") },
              }}
            />
          </section>
        </aside>
      </div>
    </>
  );
}
