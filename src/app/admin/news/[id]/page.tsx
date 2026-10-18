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
import ImageUploadForm from "../ImageUploadForm";
import { addNewsImageAction, deleteNewsAction, deleteNewsImageAction, pinNewsAction, publishNewsAction, unpublishNewsAction, updateNewsAction } from "../actions";

export const metadata: Metadata = { title: "编辑新鲜事" };

export default async function AdminNewsEditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const post = await prisma.newsPost.findUnique({
    where: { id },
    include: {
      column: { select: { slug: true, nameZh: true, nameEn: true } },
      images: { orderBy: { position: "asc" }, select: { id: true, position: true, caption: true, alt: true, mimeType: true, width: true, height: true } },
      sources: { orderBy: { position: "asc" }, select: { url: true } },
    },
  });
  if (!post) notFound();
  const columns = await prisma.newsColumn.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, nameZh: true, nameEn: true } });
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
        <div>
          <section className="blk">
            <div className="section-t">{tr(locale, "Content", "内容")}</div>
          <NewsForm
            action={updateNewsAction}
            columns={columns}
            initial={{ id: post.id, kind, columnSlug: post.column?.slug ?? "", titleZh: post.titleZh ?? "", titleEn: post.titleEn ?? "", bodyZh: post.bodyZh ?? "", bodyEn: post.bodyEn ?? "", sourceUrl: post.sourceUrl ?? "", sources: post.sources.map((source) => source.url) }}
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
              save: tr(locale, "Save changes", "保存修改"),
              saving: tr(locale, "Saving…", "保存中……"),
              hint: tr(locale, "Blank lines separate paragraphs. Saving does not publish.", "空行分段；保存不会发布。"),
              kinds: { article: tr(locale, "Article", "文章"), brief: tr(locale, "Brief", "短讯"), flash: tr(locale, "Flash", "快讯") },
            }}
          />
        </section>

        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Images", "图片")}</span>
            <span className="chip gray">{post.images.length}</span>
          </div>
          {post.images.length > 0 && (
            <div className="news-image-list">
              {post.images.map((image) => (
                <div className="news-image-row" key={image.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail from the image store */}
                  <img src={`/api/news-images/${image.id}`} alt={image.alt ?? ""} width={140} loading="lazy" />
                  <div>
                    <small className="mono">{tr(locale, "after paragraph", "第几段之后")} {image.position} · {image.width && image.height ? `${image.width}×${image.height} · ` : ""}{image.mimeType}</small>
                    {image.caption ? <p>{image.caption}</p> : null}
                  </div>
                  <form action={deleteNewsImageAction}>
                    <input type="hidden" name="id" value={image.id} />
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="slug" value={post.slug} />
                    <button className="minibtn danger" type="submit">{tr(locale, "Remove", "删除")}</button>
                  </form>
                </div>
              ))}
            </div>
          )}
          <ImageUploadForm
            action={addNewsImageAction}
            postId={post.id}
            slug={post.slug}
            labels={{
              image: tr(locale, "Image file", "图片文件"),
              position: tr(locale, "Insert after paragraph (0 = top)", "插入位置（第几段之后，0 = 开头）"),
              caption: tr(locale, "Caption", "图注"),
              alt: tr(locale, "Alt text", "替代文本"),
              submit: tr(locale, "Upload image", "上传图片"),
              submitting: tr(locale, "Uploading…", "上传中……"),
              hint: tr(locale, "PNG, JPEG, WebP or GIF, up to 8MB. The image is stored with the post and served at a private address.", "PNG、JPEG、WebP 或 GIF，最大 8MB。图片与条目一起存储，通过独立地址提供。"),
            }}
          />
        </section>
        </div>

        <aside>
          <section className="blk">
            <div className="section-t">{tr(locale, "Lifecycle", "发布状态")}</div>
            <p className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {locale === "zh-CN" ? NEWS_KIND_LABEL[kind].zh : NEWS_KIND_LABEL[kind].en}
              {" · "}{tr(locale, "created", "创建于")} {when(post.createdAt, locale)}
              {post.publishedAt ? <> · {tr(locale, "published", "发布于")} {when(post.publishedAt, locale)}</> : null}
            </p>
            <div className="admin-actions mt-10">
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
