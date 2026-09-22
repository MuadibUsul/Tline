import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { DASHBOARD_TEMPLATES } from "@/lib/dashboards";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { noIndex } from "@/lib/seo";
import { createDashboard, deleteDashboard } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards", ...noIndex };

export default async function DashboardsPage() {
  const locale = await getLocale();
  const user = await getSessionUser();
  const entitled = can(user, "dashboards.manage");
  const alertsEntitled = can(user, "dashboards.alerts");
  const dashboards = entitled && user ? await prisma.dashboard.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rules: true } } },
  }) : [];
  const approved = await prisma.dashboardTemplate.findMany({ where: { status: "APPROVED", builtinKey: { not: null } }, orderBy: [{ sortOrder: "asc" }, { reviewedAt: "desc" }] });
  const overrides = new Map(approved.filter((item) => item.builtinKey).map((item) => [item.builtinKey!, item]));
  const templates = DASHBOARD_TEMPLATES.map((preset, index) => { const saved = overrides.get(preset.key); return { id: preset.key, builtinKey: preset.key, name: saved?.name ?? (locale === "zh-CN" ? preset.nameZh : preset.nameEn), description: saved?.description || (locale === "zh-CN" ? preset.descriptionZh : preset.descriptionEn), wallpaper: preset.wallpaper, accent: preset.accent, widgets: preset.widgets, order: saved?.sortOrder ?? index * 10 }; }).sort((a, b) => a.order - b.order);

  return (
    <main className="wrap dashboards-home">
      <header className="page-head dashboard-home-head">
        <div className="eyebrow">{tr(locale, "Community workspace", "社区工作台")}</div>
        <h1>{tr(locale, "Monitoring dashboards", "自定义监控看板")}</h1>
        <div className="dashboard-home-intro">
          <p className="sub">{tr(locale, "Build a live desk for a central bank, macro theme or asset. Place data, research and alerts on one infinite canvas.", "围绕央行、宏观主题或具体品种搭建实时工作台，在一张无限画布上自由组合数据、研报与提醒。")}</p>
          <Link className="dashboard-plaza-cta" href={localePath(locale, "/dashboards/explore")}>
            <span>{tr(locale, "Community", "社区精选")}</span>
            <strong>{tr(locale, "Dashboard plaza", "看板广场")} <i>→</i></strong>
            <small>{tr(locale, "Discover public dashboards", "发现并使用公开看板")}</small>
          </Link>
        </div>
        <div className="dashboard-feature-row">
          <span>{tr(locale, "Infinite canvas", "无限画布")}</span>
          <span>{tr(locale, "Live data cards", "实时数据卡片")}</span>
          <span>{tr(locale, "Per-widget alerts", "卡片级提醒")}</span>
          <span>{tr(locale, "Custom wallpaper", "自定义壁纸")}</span>
        </div>
      </header>

      {!user && <section className="dashboard-upgrade"><div><b>{tr(locale, "Sign in to create a workspace", "登录后创建工作台")}</b><p>{tr(locale, "Dashboards are saved to your account and stay private.", "看板保存在你的账户中，并且仅你本人可见。")}</p></div><Link className="minibtn p" href={localePath(locale, "/signin?next=/dashboards")}>{tr(locale, "Sign in", "登录")} →</Link></section>}
      {user && !alertsEntitled && <section className="dashboard-upgrade"><div><b>{tr(locale, "Build and publish for free", "免费创建并发布模板")}</b><p>{tr(locale, "Every registered user can build and submit templates. Live alerts remain a Professional feature.", "所有注册用户都可以创建并投稿模板；实时提醒仍属于专业版功能。")}</p></div><span className="chip acc">{tr(locale, "Alerts · PRO", "提醒 · PRO")}</span></section>}

      {dashboards.length > 0 && <section className="dashboard-owned">
        <div className="dashboards-section-head"><h2>{tr(locale, "Your dashboards", "我的看板")}</h2><span>{dashboards.length}</span></div>
        <div className="dashboard-grid">{dashboards.map((dashboard) => <article className={`dashboard-tile wallpaper-${dashboard.wallpaper}`} key={dashboard.id} style={{ "--dashboard-accent": dashboard.accent } as CSSProperties}>
          <Link href={localePath(locale, `/dashboards/${dashboard.id}`)}><span className="dashboard-tile-kicker">{dashboard.templateKey ?? tr(locale, "Custom", "自定义")}</span><h3>{dashboard.name}</h3><small>{tr(locale, `${dashboard._count.rules} alerts`, `${dashboard._count.rules} 条提醒`)} · {tr(locale, "Updated", "更新于")} {dashboard.updatedAt.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US")}</small></Link>
          <form action={deleteDashboard}><input type="hidden" name="id" value={dashboard.id} /><button className="dashboard-delete" type="submit" aria-label={tr(locale, "Delete dashboard", "删除看板")}>×</button></form>
        </article>)}</div>
      </section>}

      <section>
        <div className="dashboards-section-head"><h2>{tr(locale, "Start from a template", "从模板开始")}</h2><span>{templates.length + 1}</span></div>
        <div className="dashboard-grid dashboard-template-grid">
          {templates.map((template) => <article className={`dashboard-template wallpaper-${template.wallpaper}`} key={template.id} style={{ "--dashboard-accent": template.accent } as CSSProperties}>
            <div className="dashboard-template-preview">{template.widgets.slice(0, 5).map((item) => <i key={item.id} style={{ left: `${8 + (item.x % 500) / 8}%`, top: `${10 + (item.y % 300) / 5}%`, width: `${Math.min(34, item.w / 14)}%` }} />)}</div>
            <div><span className="dashboard-template-author"><i style={{ background: "#9e7a42" }}>TL</i>Tlines</span><h3>{template.name}</h3><p>{template.description}</p></div>
            {entitled ? <form action={createDashboard}><input type="hidden" name="template" value={template.builtinKey} /><button className="minibtn p" type="submit">{tr(locale, "Use template", "使用模板")}</button></form> : <Link className="minibtn p" href={localePath(locale, "/signin?next=/dashboards")}>{tr(locale, "Sign in to use", "登录后使用")}</Link>}
          </article>)}
          <article className="dashboard-template wallpaper-grid dashboard-custom-template">
            <div className="dashboard-template-preview"><b>＋</b></div>
            <div><span className="dashboard-tile-kicker">blank</span><h3>{tr(locale, "Blank canvas", "空白画布")}</h3><p>{tr(locale, "Start empty and add any supported data, research, note or source card.", "从空白开始，自由添加数据、研报、笔记或外部来源卡片。")}</p></div>
            {entitled ? <form action={createDashboard} className="dashboard-blank-form"><input name="name" maxLength={80} placeholder={tr(locale, "Dashboard name", "看板名称")} required /><button className="minibtn p" type="submit">{tr(locale, "Create", "创建")}</button></form> : <Link className="minibtn p" href={localePath(locale, "/signin?next=/dashboards")}>{tr(locale, "Sign in", "登录")}</Link>}
          </article>
        </div>
      </section>
    </main>
  );
}
