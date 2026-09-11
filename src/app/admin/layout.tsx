import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getLocale, tr, localePath } from "@/lib/i18n";
import { can, effectiveRole, isOperationsOwner, type PermissionAction } from "@/lib/permissions";
import { noIndex } from "@/lib/seo";
import AdminNav, { type AdminNavGroup } from "./_components/AdminNav";

export const dynamic = "force-dynamic";

// Behind a sign-in: robots.txt asks a crawler not to fetch this, which does not keep it
// out of an index if something links to it. This does, for the whole console at once.
export const metadata: Metadata = { title: { default: "Console", template: "%s · Console" }, ...noIndex };

/**
 * The console's one door.
 *
 * Every page below used to repeat the same permission check, which is a pattern that
 * fails silently the first time someone forgets. The layout wraps all of them, so a new
 * page is protected before it is written; individual pages only narrow it further when
 * they need a stronger permission than "may open the console".
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.access")) notFound();
  const locale = await getLocale();

  const item = (action: PermissionAction, path: string, en: string, zh: string) =>
    can(user, action) ? [{ href: localePath(locale, path), match: path, label: tr(locale, en, zh) }] : [];

  const groups: AdminNavGroup[] = [
    {
      title: tr(locale, "Overview", "总览"),
      items: [{ href: localePath(locale, "/admin"), match: "/admin", label: tr(locale, "Dashboard", "仪表盘") }],
    },
    {
      title: tr(locale, "Audience", "访问分析"),
      items: [
        ...item("admin.analytics", "/admin/analytics", "Traffic", "流量"),
        ...item("admin.analytics", "/admin/analytics/audience", "Visitors & users", "访客与用户"),
      ],
    },
    {
      title: tr(locale, "People", "用户"),
      items: item("admin.users", "/admin/users", "Accounts", "账户管理"),
    },
    {
      title: tr(locale, "Pipeline", "内容管道"),
      items: [
        ...item("admin.sources", "/admin/sources", "Sources & crawler", "来源与爬虫"),
        ...item("admin.review", "/admin/review", "Editorial review", "内容审核"),
        ...item("admin.review", "/admin/jobs", "Jobs & workers", "任务与调度"),
      ],
    },
    {
      title: tr(locale, "Platform", "平台"),
      items: [
        ...item("admin.social", "/admin/social", "Publishing", "内容发布"),
        ...item("admin.models", "/admin/models", "Model providers", "模型接入"),
        ...item("admin.api", "/admin/api", "API & keys", "API 与密钥"),
        ...item("admin.audit", "/admin/audit", "Audit log", "审计日志"),
      ],
    },
  ].filter((group) => group.items.length > 0);

  return (
    <main className="wrap admin-shell">
      <aside className="admin-side">
        <div className="admin-side-head">
          <span className="eyebrow">{tr(locale, "Console", "管理后台")}</span>
          <b>{tr(locale, "Operations", "运营")}</b>
        </div>
        <AdminNav groups={groups} />
        <div className="admin-side-foot">
          <span className="chip acc">{effectiveRole(user)}</span>
          {isOperationsOwner(user) && <span className="chip gray" title={tr(locale, "Granted by ADMIN_EMAILS", "由 ADMIN_EMAILS 授予")}>owner</span>}
          <a className="admin-side-link" href={localePath(locale, "/api/health")} target="_blank" rel="noreferrer">Health JSON ↗</a>
        </div>
      </aside>
      <div className="admin-body">{children}</div>
    </main>
  );
}
