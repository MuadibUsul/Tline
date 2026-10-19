import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAdminLocale, tr, type Locale } from "@/lib/i18n";
import { deleteAnnouncementAction, saveAnnouncementAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "首页公告位" };

interface Announcement {
  id: string;
  labelEn: string;
  labelZh: string;
  titleEn: string;
  titleZh: string;
  bodyEn: string | null;
  bodyZh: string | null;
  href: string;
  active: boolean;
  sortOrder: number;
}

function Fields({ item, locale }: { item?: Announcement; locale: Locale }) {
  return (
    <>
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <div className="announcement-admin-grid">
        <label className="news-field"><span>{tr(locale, "Chinese label", "中文标签")}</span><input name="labelZh" defaultValue={item?.labelZh ?? "公告"} maxLength={24} /></label>
        <label className="news-field"><span>{tr(locale, "English label", "英文标签")}</span><input name="labelEn" defaultValue={item?.labelEn ?? "Announcement"} maxLength={24} /></label>
        <label className="news-field"><span>{tr(locale, "Chinese title", "中文标题")}</span><input name="titleZh" defaultValue={item?.titleZh ?? ""} required maxLength={120} /></label>
        <label className="news-field"><span>{tr(locale, "English title", "英文标题")}</span><input name="titleEn" defaultValue={item?.titleEn ?? ""} required maxLength={120} /></label>
        <label className="news-field"><span>{tr(locale, "Chinese body", "中文正文")}</span><textarea name="bodyZh" defaultValue={item?.bodyZh ?? ""} rows={3} maxLength={500} /></label>
        <label className="news-field"><span>{tr(locale, "English body", "英文正文")}</span><textarea name="bodyEn" defaultValue={item?.bodyEn ?? ""} rows={3} maxLength={500} /></label>
        <label className="news-field"><span>{tr(locale, "Link", "链接")}</span><input name="href" defaultValue={item?.href ?? "/mcp"} required placeholder="/mcp" /></label>
        <label className="news-field"><span>{tr(locale, "Order", "排序")}</span><input name="sortOrder" type="number" defaultValue={item?.sortOrder ?? 10} /></label>
      </div>
      <div className="announcement-admin-state">
        <label><input type="checkbox" name="active" defaultChecked={item?.active ?? true} /> {tr(locale, "Active", "启用")}</label>
        <small>{tr(locale, "Only the first active item is shown on the home page.", "首页只显示排序最前的一条启用公告。")}</small>
      </div>
    </>
  );
}

export default async function AnnouncementsPage(props: { searchParams: Promise<{ saved?: string; deleted?: string; error?: string }> }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const announcements = await prisma.homeAnnouncement.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }] });

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Homepage announcement", "首页公告位")}</h1>
          <p className="sub">{tr(locale, "The slot above the newsroom: an announcement, a promotion or a house notice. Only the first active item is rendered on the home page.", "新鲜事上方的公告/广告位。首页只渲染排序最前的一条启用项。")}</p>
        </div>
        <div className="tag-row"><span className="chip acc">{announcements.length}</span></div>
      </header>

      {params.saved && <p className="chip bull" role="status">{tr(locale, "Saved.", "已保存。")}</p>}
      {params.deleted && <p className="chip bear" role="status">{tr(locale, "Deleted.", "已删除。")}</p>}
      {params.error && <p className="apikey-error" role="alert">{tr(locale, "Title and a safe link are required.", "标题和合法链接为必填项。")}</p>}

      <div className="admin-columns">
        <section className="blk">
          <div className="section-t"><span>{tr(locale, "Existing placements", "现有公告")}</span></div>
          <div className="announcement-admin-list">
            {announcements.length === 0 && <div className="empty-state">{tr(locale, "No announcement yet. Create one on the right.", "还没有公告，在右侧新建。")}</div>}
            {announcements.map((item) => (
              <article className="admin-panel announcement-admin-item" key={item.id}>
                <div className="announcement-admin-head">
                  <div><span className="eyebrow">{item.labelZh} · {item.labelEn}</span><b>{item.titleZh}</b></div>
                  <span className={`chip ${item.active ? "bull" : "gray"}`}>{item.active ? tr(locale, "Active", "启用") : tr(locale, "Off", "停用")}</span>
                </div>
                <form action={saveAnnouncementAction} className="news-form">
                  <Fields item={item} locale={locale} />
                  <div className="announcement-admin-actions">
                    <button type="submit" className="minibtn p">{tr(locale, "Save", "保存")}</button>
                  </div>
                </form>
                <form action={deleteAnnouncementAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" className="minibtn">{tr(locale, "Delete", "删除")}</button>
                </form>
              </article>
            ))}
          </div>
        </section>

        <aside>
          <section className="blk">
            <div className="section-t"><span>{tr(locale, "New placement", "新建公告")}</span></div>
            <form action={saveAnnouncementAction} className="admin-panel news-form">
              <Fields locale={locale} />
              <button type="submit" className="minibtn p">{tr(locale, "Create", "创建")}</button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
