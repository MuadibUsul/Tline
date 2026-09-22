import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { generatedAvatar } from "@/lib/avatar";
import { parseDashboardWidgets } from "@/lib/dashboards";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { createDashboard } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard plaza" };

export default async function DashboardExplorePage() {
  const locale = await getLocale();
  const user = await getSessionUser();
  const canUse = can(user, "dashboards.manage");
  const templates = await prisma.dashboardTemplate.findMany({
    where: { status: "APPROVED", builtinKey: null },
    orderBy: [{ sortOrder: "asc" }, { useCount: "desc" }, { reviewedAt: "desc" }],
    include: { author: { select: { name: true, email: true } } },
  });

  return <main className="wrap dashboards-home dashboard-plaza">
    <header className="page-head dashboard-home-head">
      <Link className="minibtn dashboard-plaza-link" href={localePath(locale, "/dashboards")}>← {tr(locale, "My dashboards", "我的看板")}</Link>
      <div className="eyebrow">{tr(locale, "Published by the community", "社区用户发布")}</div>
      <h1>{tr(locale, "Dashboard plaza", "看板广场")}</h1>
      <p className="sub">{tr(locale, "Explore approved public dashboards. Anyone with an account can copy one into a private workspace and adapt it.", "浏览审核通过的公开看板；任何注册用户都可以复制到自己的私人工作台继续修改。")}</p>
    </header>
    <div className="dashboards-section-head"><h2>{tr(locale, "Public dashboards", "公开看板")}</h2><span>{templates.length}</span></div>
    {templates.length ? <div className="dashboard-grid dashboard-template-grid">{templates.map((template) => {
      const widgets = parseDashboardWidgets(template.layoutJson);
      const avatar = generatedAvatar(template.author?.name ?? "Member", template.author?.email);
      return <article className="dashboard-template wallpaper-grid" key={template.id} style={{ "--dashboard-accent": template.accent } as CSSProperties}>
        <div className="dashboard-template-preview" style={template.coverUrl ? { backgroundImage: `linear-gradient(rgba(8,11,17,.18),rgba(8,11,17,.48)),url(${JSON.stringify(template.coverUrl)})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>{!template.coverUrl && widgets.slice(0, 6).map((item) => <i key={item.id} style={{ left: `${8 + (item.x % 500) / 8}%`, top: `${10 + (item.y % 300) / 5}%`, width: `${Math.min(34, item.w / 14)}%` }} />)}</div>
        <div><span className="dashboard-template-author"><i style={{ background: avatar.color }}>{avatar.initials}</i>{template.author?.name || tr(locale, "Community member", "社区用户")}</span><h3>{template.name}</h3><p>{template.description}</p><small className="dashboard-use-count">{tr(locale, `${template.useCount} uses`, `${template.useCount} 人使用`)}</small></div>
        {canUse ? <form action={createDashboard}><input type="hidden" name="templateId" value={template.id} /><button className="minibtn p" type="submit">{tr(locale, "Use this dashboard", "使用这个看板")}</button></form> : <Link className="minibtn p" href={localePath(locale, "/signin?next=/dashboards/explore")}>{tr(locale, "Sign in to use", "登录后使用")}</Link>}
      </article>;
    })}</div> : <div className="empty-state">{tr(locale, "No approved community dashboards yet.", "暂时还没有审核通过的社区看板。")}</div>}
  </main>;
}
