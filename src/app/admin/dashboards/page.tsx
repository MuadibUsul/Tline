import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { DASHBOARD_TEMPLATES } from "@/lib/dashboards";
import { deleteDashboardBackground, saveDashboardBackground, saveDashboardTemplateReview } from "./actions";

export const metadata: Metadata = { title: "看板模板" };

export default async function AdminDashboardTemplatesPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const [records, backgrounds] = await Promise.all([
    prisma.dashboardTemplate.findMany({ orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }], include: { author: { select: { name: true, email: true } } } }),
    prisma.dashboardBackground.findMany({ orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }] }),
  ]);
  const overrides = new Map(records.filter((item) => item.builtinKey).map((item) => [item.builtinKey!, item]));
  const community = records.filter((item) => !item.builtinKey);
  const form = (item: { id?: string; builtinKey?: string | null; name: string; description: string; status: string; sortOrder: number; useCount?: number; author?: { name: string | null; email: string } | null }, builtin = false) => <form action={saveDashboardTemplateReview} className="admin-panel dashboard-template-admin" key={item.builtinKey ?? item.id}>
    {item.id && <input type="hidden" name="id" value={item.id} />}{item.builtinKey && <input type="hidden" name="builtinKey" value={item.builtinKey} />}
    <div className="section-t"><span>{item.name}</span><span className={`chip ${item.status === "APPROVED" ? "bull" : item.status === "REJECTED" ? "bear" : "gray"}`}>{builtin ? "内置" : item.status}</span></div>
    {item.author && <p className="muted">作者：{item.author.name || item.author.email} · 已被使用 {item.useCount ?? 0} 次</p>}
    <label><span>模板名称</span><input name="name" defaultValue={item.name} maxLength={80} required /></label>
    <label><span>介绍</span><textarea name="description" defaultValue={item.description} maxLength={300} /></label>
    <label><span>排序（越小越靠前）</span><input name="sortOrder" type="number" defaultValue={item.sortOrder} /></label>
    {!builtin && <label><span>审核状态</span><select name="status" defaultValue={item.status}><option value="PENDING">待审核</option><option value="APPROVED">批准</option><option value="REJECTED">拒绝</option></select></label>}
    <button className="minibtn p" type="submit">保存设置</button>
  </form>;
  return <div><div className="page-head"><div className="eyebrow">运营</div><h1>看板与通用背景</h1><p className="sub">审核用户投稿、设置展示顺序，并维护所有看板都可选择的通用背景图库。</p></div>
    <div className="section-t"><span>通用背景图库</span><span className="chip gray">{backgrounds.length}</span></div>
    <form action={saveDashboardBackground} className="admin-panel dashboard-template-admin"><div className="form-grid"><label><span>背景名称</span><input name="name" maxLength={80} required /></label><label><span>图片 URL</span><input name="imageUrl" type="url" placeholder="https://…" required /></label><label><span>排序</span><input name="sortOrder" type="number" defaultValue={1000} /></label><label><span>状态</span><span><input name="enabled" type="checkbox" defaultChecked /> 启用</span></label></div><button className="minibtn p" type="submit">添加背景</button></form>
    {backgrounds.map((background) => <div className="admin-panel dashboard-template-admin" key={background.id}><form action={saveDashboardBackground}><input type="hidden" name="id" value={background.id} /><div className="form-grid"><label><span>背景名称</span><input name="name" defaultValue={background.name} required /></label><label><span>图片 URL</span><input name="imageUrl" type="url" defaultValue={background.imageUrl} required /></label><label><span>排序</span><input name="sortOrder" type="number" defaultValue={background.sortOrder} /></label><label><span>状态</span><span><input name="enabled" type="checkbox" defaultChecked={background.enabled} /> 启用</span></label></div><button className="minibtn" type="submit">保存</button></form><form action={deleteDashboardBackground}><input type="hidden" name="id" value={background.id} /><button className="dashboard-remove" type="submit">删除背景</button></form></div>)}
    <div className="section-t"><span>用户投稿</span><span className="chip gray">{community.length}</span></div>{community.length ? community.map((item) => form(item)) : <div className="empty-state">暂无用户投稿。</div>}
    <div className="section-t"><span>内置预设</span><span className="chip gray">{DASHBOARD_TEMPLATES.length}</span></div>{DASHBOARD_TEMPLATES.map((preset, index) => { const saved = overrides.get(preset.key); return form({ id: saved?.id, builtinKey: preset.key, name: saved?.name ?? preset.nameZh, description: saved?.description ?? preset.descriptionZh, status: "APPROVED", sortOrder: saved?.sortOrder ?? index * 10 }, true); })}
  </div>;
}
