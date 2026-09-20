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
  const dashboards = entitled && user ? await prisma.dashboard.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { rules: true } } },
  }) : [];

  return (
    <main className="wrap dashboards-home">
      <header className="page-head dashboard-home-head">
        <div className="eyebrow">{tr(locale, "Premium workspace", "专业版工作台")}</div>
        <h1>{tr(locale, "Monitoring dashboards", "自定义监控看板")}</h1>
        <p className="sub">{tr(locale, "Build a live desk for a central bank, macro theme or asset. Place data, research and alerts on one infinite canvas.", "围绕央行、宏观主题或具体品种搭建实时工作台，在一张无限画布上自由组合数据、研报与提醒。")}</p>
        <div className="dashboard-feature-row">
          <span>{tr(locale, "Infinite canvas", "无限画布")}</span>
          <span>{tr(locale, "Live data cards", "实时数据卡片")}</span>
          <span>{tr(locale, "Per-widget alerts", "卡片级提醒")}</span>
          <span>{tr(locale, "Custom wallpaper", "自定义壁纸")}</span>
        </div>
      </header>

      {!user && <section className="dashboard-upgrade"><div><b>{tr(locale, "Sign in to create a workspace", "登录后创建工作台")}</b><p>{tr(locale, "Dashboards are saved to your account and stay private.", "看板保存在你的账户中，并且仅你本人可见。")}</p></div><Link className="minibtn p" href={localePath(locale, "/signin?next=/dashboards")}>{tr(locale, "Sign in", "登录")} →</Link></section>}
      {user && !entitled && <section className="dashboard-upgrade"><div><b>{tr(locale, "Included with Professional", "专业版功能")}</b><p>{tr(locale, "Professional, Enterprise and Founding accounts can create unlimited custom dashboards.", "专业版、企业版与创始会员可以创建不限数量的自定义看板。")}</p></div><span className="chip acc">{tr(locale, "Upgrade required", "需要升级")}</span></section>}

      {dashboards.length > 0 && <section className="dashboard-owned">
        <div className="dashboards-section-head"><h2>{tr(locale, "Your dashboards", "我的看板")}</h2><span>{dashboards.length}</span></div>
        <div className="dashboard-grid">{dashboards.map((dashboard) => <article className={`dashboard-tile wallpaper-${dashboard.wallpaper}`} key={dashboard.id} style={{ "--dashboard-accent": dashboard.accent } as CSSProperties}>
          <Link href={localePath(locale, `/dashboards/${dashboard.id}`)}><span className="dashboard-tile-kicker">{dashboard.templateKey ?? tr(locale, "Custom", "自定义")}</span><h3>{dashboard.name}</h3><small>{tr(locale, `${dashboard._count.rules} alerts`, `${dashboard._count.rules} 条提醒`)} · {tr(locale, "Updated", "更新于")} {dashboard.updatedAt.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US")}</small></Link>
          <form action={deleteDashboard}><input type="hidden" name="id" value={dashboard.id} /><button className="dashboard-delete" type="submit" aria-label={tr(locale, "Delete dashboard", "删除看板")}>×</button></form>
        </article>)}</div>
      </section>}

      <section>
        <div className="dashboards-section-head"><h2>{tr(locale, "Start from a template", "从模板开始")}</h2><span>{DASHBOARD_TEMPLATES.length + 1}</span></div>
        <div className="dashboard-grid dashboard-template-grid">
          {DASHBOARD_TEMPLATES.map((template) => <article className={`dashboard-template wallpaper-${template.wallpaper}`} key={template.key} style={{ "--dashboard-accent": template.accent } as CSSProperties}>
            <div className="dashboard-template-preview">{template.widgets.slice(0, 5).map((item) => <i key={item.id} style={{ left: `${8 + (item.x % 500) / 8}%`, top: `${10 + (item.y % 300) / 5}%`, width: `${Math.min(34, item.w / 14)}%` }} />)}</div>
            <div><span className="dashboard-tile-kicker">{template.key}</span><h3>{locale === "zh-CN" ? template.nameZh : template.nameEn}</h3><p>{locale === "zh-CN" ? template.descriptionZh : template.descriptionEn}</p></div>
            {entitled ? <form action={createDashboard}><input type="hidden" name="template" value={template.key} /><button className="minibtn p" type="submit">{tr(locale, "Use template", "使用模板")}</button></form> : <span className="chip gray">PRO</span>}
          </article>)}
          <article className="dashboard-template wallpaper-grid dashboard-custom-template">
            <div className="dashboard-template-preview"><b>＋</b></div>
            <div><span className="dashboard-tile-kicker">blank</span><h3>{tr(locale, "Blank canvas", "空白画布")}</h3><p>{tr(locale, "Start empty and add any supported data, research, note or source card.", "从空白开始，自由添加数据、研报、笔记或外部来源卡片。")}</p></div>
            {entitled ? <form action={createDashboard} className="dashboard-blank-form"><input name="name" maxLength={80} placeholder={tr(locale, "Dashboard name", "看板名称")} required /><button className="minibtn p" type="submit">{tr(locale, "Create", "创建")}</button></form> : <span className="chip gray">PRO</span>}
          </article>
        </div>
      </section>
    </main>
  );
}
