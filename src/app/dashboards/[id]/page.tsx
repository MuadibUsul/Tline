import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseDashboardWidgets } from "@/lib/dashboards";
import { loadDashboardWidgetData } from "@/lib/dashboardData";
import { taxonomy } from "@/lib/classification/taxonomy";
import { getLocale, localePath, tr } from "@/lib/i18n";
import { noIndex } from "@/lib/seo";
import DashboardCanvas from "./DashboardCanvas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard", ...noIndex };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) redirect(localePath(locale, `/signin?next=/dashboards/${(await params).id}`));
  if (!can(user, "dashboards.manage")) redirect(localePath(locale, "/dashboards?upgrade=1"));
  const { id } = await params;
  const dashboard = await prisma.dashboard.findFirst({
    where: { id, userId: user.id },
    include: { rules: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { firedAt: "desc" }, take: 1 } } } },
  });
  if (!dashboard) notFound();
  const widgets = parseDashboardWidgets(dashboard.layoutJson);
  const [data, assets, indicators] = await Promise.all([
    loadDashboardWidgetData(widgets, locale),
    prisma.asset.findMany({ orderBy: { ticker: "asc" }, select: { ticker: true, name: true } }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, orderBy: [{ countryCode: "asc" }, { nameEn: "asc" }], select: { canonicalKey: true, nameEn: true, nameZh: true } }),
  ]);

  return (
    <main className="dashboard-page">
      <div className="dashboard-breadcrumb"><Link href={localePath(locale, "/dashboards")}>← {tr(locale, "All dashboards", "全部看板")}</Link><span>{dashboard.templateKey ?? tr(locale, "Custom", "自定义")}</span></div>
      <DashboardCanvas
        dashboard={{ id: dashboard.id, name: dashboard.name, wallpaper: dashboard.wallpaper, wallpaperUrl: dashboard.wallpaperUrl ?? "", accent: dashboard.accent }}
        initialWidgets={widgets}
        data={data}
        assets={assets}
        indicators={indicators.map((item) => ({ key: item.canonicalKey, label: locale === "zh-CN" ? item.nameZh ?? item.nameEn : item.nameEn }))}
        institutions={taxonomy.institutions.map((item) => ({ key: item.key, label: locale === "zh-CN" ? item.nameZh : item.nameEn }))}
        topics={taxonomy.topics.map((item) => ({ key: item.key, label: locale === "zh-CN" ? item.nameZh : item.nameEn }))}
        rules={dashboard.rules.map((rule) => ({ id: rule.id, name: rule.name, active: rule.active, lastFiredAt: rule.events[0]?.firedAt.toISOString() ?? null }))}
        locale={locale}
      />
    </main>
  );
}
