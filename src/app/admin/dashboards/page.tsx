import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { DASHBOARD_TEMPLATES, DASHBOARD_WALLPAPERS } from "@/lib/dashboards";
import { saveDashboardTemplateReview } from "./actions";

export const metadata: Metadata = { title: "看板模板" };

export default async function AdminDashboardTemplatesPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const records = await prisma.dashboardTemplate.findMany({ orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }], include: { author: { select: { name: true, email: true } } } });
  const overrides = new Map(records.filter((item) => item.builtinKey).map((item) => [item.builtinKey!, item]));
  const community = records.filter((item) => !item.builtinKey);
  const form = (item: { id?: string; builtinKey?: string | null; name: string; description: string; coverUrl?: string | null; wallpaper: string; wallpaperUrl?: string | null; accent: string; status: string; sortOrder: number; author?: { name: string | null; email: string } | null }, builtin = false) => <form action={saveDashboardTemplateReview} className="admin-panel dashboard-template-admin" key={item.builtinKey ?? item.id}>
    {item.id && <input type="hidden" name="id" value={item.id} />}{item.builtinKey && <input type="hidden" name="builtinKey" value={item.builtinKey} />}
    <div className="section-t"><span>{item.name}</span><span className={`chip ${item.status === "APPROVED" ? "bull" : item.status === "REJECTED" ? "bear" : "gray"}`}>{builtin ? "内置" : item.status}</span></div>
    {item.author && <p className="muted">作者：{item.author.name || item.author.email}</p>}
    <div className="form-grid"><label><span>模板名称</span><input name="name" defaultValue={item.name} maxLength={80} required /></label><label><span>封面图片 URL</span><input name="coverUrl" type="url" defaultValue={item.coverUrl ?? ""} placeholder="https://…" /></label></div>
    <label><span>介绍</span><textarea name="description" defaultValue={item.description} maxLength={300} /></label>
    <div className="form-grid"><label><span>背景预设</span><select name="wallpaper" defaultValue={item.wallpaper}>{DASHBOARD_WALLPAPERS.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>背景图片 URL</span><input name="wallpaperUrl" type="url" defaultValue={item.wallpaperUrl ?? ""} placeholder="https://…" /></label><label><span>强调色</span><input name="accent" type="color" defaultValue={item.accent} /></label><label><span>排序（越小越靠前）</span><input name="sortOrder" type="number" defaultValue={item.sortOrder} /></label></div>
    {!builtin && <label><span>审核状态</span><select name="status" defaultValue={item.status}><option value="PENDING">待审核</option><option value="APPROVED">批准</option><option value="REJECTED">拒绝</option></select></label>}
    <button className="minibtn p" type="submit">保存设置</button>
  </form>;
  return <div><div className="page-head"><div className="eyebrow">运营</div><h1>看板模板</h1><p className="sub">审核用户投稿，设置模板名称、封面、背景和展示顺序。</p></div>
    <div className="section-t"><span>用户投稿</span><span className="chip gray">{community.length}</span></div>{community.length ? community.map((item) => form(item)) : <div className="empty-state">暂无用户投稿。</div>}
    <div className="section-t"><span>内置预设</span><span className="chip gray">{DASHBOARD_TEMPLATES.length}</span></div>{DASHBOARD_TEMPLATES.map((preset, index) => { const saved = overrides.get(preset.key); return form({ id: saved?.id, builtinKey: preset.key, name: saved?.name ?? preset.nameZh, description: saved?.description ?? preset.descriptionZh, coverUrl: saved?.coverUrl, wallpaper: saved?.wallpaper ?? preset.wallpaper, wallpaperUrl: saved?.wallpaperUrl, accent: saved?.accent ?? preset.accent, status: "APPROVED", sortOrder: saved?.sortOrder ?? index * 10 }, true); })}
  </div>;
}
