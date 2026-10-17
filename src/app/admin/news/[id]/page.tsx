import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { isNewsKind, NEWS_KIND_LABEL } from "@/lib/news";
import { when } from "@/app/admin/_components/format";
import NewsForm from "../NewsForm";
import { deleteNewsAction, pinNewsAction, publishNewsAction, unpublishNewsAction, updateNewsAction } from "../actions";

export const metadata: Metadata = { title: "编辑新鲜事" };

export default async function AdminNewsEditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const post = await prisma.newsPost.findUnique({ where: { id } });
  if (!post) notFound();
  const kind = isNewsKind(post.kind) ? post.kind : "brief";
  const published = post.status === "published";

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Edit news item", "编辑新鲜事")}</h1>
          <p className="sub">
            {tr(locale, "The slug is fixed at creation; editing never changes a published address.", "链接在创建时确定，编辑不会改变已发布地址。")}
            {" "}
            <code>{post.slug}</code>
          </p>
        </div>
        <div className="tag-row">
          <span className={`chip ${published ? "bull" : "gray"}`}>{published ? tr(locale, "Published", "已发布") : tr(locale, "Draft", "草稿")}</span>
          {post.pinned ? <span className="chip acc">{tr(locale, "Pinned", "置顶")}</span> : null}
          {published ? <Link className="chip" href={localePath(locale, `/news/${post.slug}`)}>{tr(locale, "View", "查看")} ↗</Link> : null}
        </div>
      </header>

      {query.created === "1" && <p className="chip bull" style={{ display: "inline-block", marginBottom: 12 }}>{tr(locale, "Draft created. It becomes public when you publish it.", "草稿已创建。发布后才会公开。")}</p>}

      <div className="admin-columns">
        <section className="blk">
          <div className="section-t">{tr(locale, "Content", "内容")}</div>
          <NewsForm
            action={updateNewsAction}
            initial={{ id: post.id, kind, titleZh: post.titleZh ?? "", titleEn: post.titleEn ?? "", bodyZh: post.bodyZh ?? "", bodyEn: post.bodyEn ?? "", sourceUrl: post.sourceUrl ?? "" }}
            labels={{
              kind: tr(locale, "Kind", "类型"),
              titleZh: tr(locale, "Chinese title", "中文标题"),
              titleEn: tr(locale, "English title", "英文标题"),
              bodyZh: tr(locale, "Chinese body", "中文正文"),
              bodyEn: tr(locale, "English body", "英文正文"),
              sourceUrl: tr(locale, "Source URL (https)", "来源链接（https）"),
              save: tr(locale, "Save changes", "保存修改"),
              saving: tr(locale, "Saving…", "保存中……"),
              hint: tr(locale, "Blank lines separate paragraphs. Saving does not publish.", "空行分段；保存不会发布。"),
              kinds: { article: tr(locale, "Article", "文章"), brief: tr(locale, "Brief", "短讯"), flash: tr(locale, "Flash", "快讯") },
            }}
          />
        </section>

        <aside>
          <section className="blk">
            <div className="section-t">{tr(locale, "Lifecycle", "发布状态")}</div>
            <p className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
              {" · "}{tr(locale, "created", "创建于")} {when(post.createdAt, locale)}
              {post.publishedAt ? <> · {tr(locale, "published", "发布于")} {when(post.publishedAt, locale)}</> : null}
            </p>
            <div className="admin-actions" style={{ marginTop: 10 }}>
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
                <input type="hidden" name="from" value="edit" />
                <button className="minibtn danger" type="submit">{tr(locale, "Delete", "删除")}</button>
              </form>
            </div>
          </section>
          <p className="sub" style={{ fontSize: 12 }}>
            <Link href={localePath(locale, "/admin/news")}>← {tr(locale, "Back to the newsroom", "返回新鲜事列表")}</Link>
          </p>
        </aside>
      </div>
    </>
  );
}
