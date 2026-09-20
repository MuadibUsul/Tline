"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dashboardTemplate, DASHBOARD_WALLPAPERS, parseDashboardWidgets, validAccent, validWallpaperUrl } from "@/lib/dashboards";
import { describeRule, evaluateRules } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import { getLocale, localePath } from "@/lib/i18n";

const value = (form: FormData, key: string) => (form.get(key)?.toString() ?? "").trim();

async function paidUser() {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) redirect(localePath(locale, "/signin?next=/dashboards"));
  if (!can(user, "dashboards.manage")) redirect(localePath(locale, "/dashboards?upgrade=1"));
  return { user, locale };
}

export async function createDashboard(form: FormData) {
  const { user, locale } = await paidUser();
  const template = dashboardTemplate(value(form, "template"));
  const name = (value(form, "name") || template?.nameZh || "自定义看板").slice(0, 80);
  const dashboard = await prisma.dashboard.create({
    data: {
      userId: user.id,
      name,
      templateKey: template?.key,
      layoutJson: JSON.stringify(template?.widgets ?? []),
      wallpaper: template?.wallpaper ?? "grid",
      accent: template?.accent ?? "#9e7a42",
    },
  });
  await writeAudit({ actorId: user.id, action: "dashboard.create", targetType: "dashboard", targetId: dashboard.id, metadata: { template: template?.key ?? "custom" } });
  redirect(localePath(locale, `/dashboards/${dashboard.id}`));
}

export async function saveDashboard(input: {
  id: string;
  name: string;
  layoutJson: string;
  wallpaper: string;
  wallpaperUrl: string;
  accent: string;
}) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.manage")) return { error: "upgrade_required" } as const;
  const dashboard = await prisma.dashboard.findFirst({ where: { id: input.id, userId: user.id }, select: { id: true } });
  if (!dashboard) return { error: "not_found" } as const;
  const widgets = parseDashboardWidgets(input.layoutJson);
  await prisma.dashboard.update({
    where: { id: dashboard.id },
    data: {
      name: input.name.trim().slice(0, 80) || "Dashboard",
      layoutJson: JSON.stringify(widgets),
      wallpaper: (DASHBOARD_WALLPAPERS as readonly string[]).includes(input.wallpaper) ? input.wallpaper : "grid",
      wallpaperUrl: validWallpaperUrl(input.wallpaperUrl),
      accent: validAccent(input.accent),
    },
  });
  await writeAudit({ actorId: user.id, action: "dashboard.save", targetType: "dashboard", targetId: dashboard.id, metadata: { widgets: widgets.length } });
  revalidatePath(`/dashboards/${dashboard.id}`);
  revalidatePath("/dashboards");
  return { ok: true } as const;
}

export async function deleteDashboard(form: FormData) {
  const { user, locale } = await paidUser();
  const id = value(form, "id");
  const deleted = await prisma.dashboard.deleteMany({ where: { id, userId: user.id } });
  if (deleted.count) await writeAudit({ actorId: user.id, action: "dashboard.delete", targetType: "dashboard", targetId: id });
  redirect(localePath(locale, "/dashboards"));
}

export async function createDashboardAlert(input: {
  dashboardId: string;
  layoutJson: string;
  widgetId: string;
  type: string;
  threshold: number;
}) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.manage")) return { error: "upgrade_required" } as const;
  const dashboard = await prisma.dashboard.findFirst({ where: { id: input.dashboardId, userId: user.id }, select: { id: true } });
  if (!dashboard) return { error: "not_found" } as const;
  const widgets = parseDashboardWidgets(input.layoutJson);
  const widget = widgets.find((item) => item.id === input.widgetId);
  if (!widget?.ref) return { error: "unsupported_widget" } as const;

  let scopeKind: "asset" | "institution" | "theme" | "macro_indicator";
  let scopeRef = widget.ref;
  const allowed = widget.type === "market" ? ["CONSENSUS_ABOVE", "CONSENSUS_BELOW", "NEW_RESEARCH"]
    : widget.type === "macro" ? ["MACRO_RELEASE", "MACRO_SURPRISE_ABOVE", "MACRO_SURPRISE_BELOW"]
      : widget.type === "research" ? ["NEW_RESEARCH"] : [];
  if (!allowed.includes(input.type)) return { error: "unsupported_rule" } as const;

  if (widget.type === "market") {
    scopeKind = "asset";
    scopeRef = scopeRef.toUpperCase();
    if (!(await prisma.asset.findUnique({ where: { ticker: scopeRef }, select: { id: true } }))) return { error: "unknown_source" } as const;
  } else if (widget.type === "macro") {
    scopeKind = "macro_indicator";
    if (!(await prisma.macroIndicator.findUnique({ where: { canonicalKey: scopeRef }, select: { id: true } }))) return { error: "unknown_source" } as const;
  } else {
    scopeKind = widget.scopeKind === "asset" ? "asset" : widget.scopeKind === "institution" ? "institution" : "theme";
  }
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold) || Math.abs(threshold) > 10_000) return { error: "invalid_threshold" } as const;
  const shape = { type: input.type, threshold, scopeKind, scopeRef, assetTicker: scopeKind === "asset" ? scopeRef : null };
  const rule = await prisma.$transaction(async (tx) => {
    await tx.dashboard.update({ where: { id: dashboard.id }, data: { layoutJson: JSON.stringify(widgets) } });
    return tx.alertRule.create({ data: { userId: user.id, dashboardId: dashboard.id, name: describeRule(shape), ...shape } });
  });
  await writeAudit({ actorId: user.id, action: "dashboard.alert.create", targetType: "alert_rule", targetId: rule.id, metadata: { dashboardId: dashboard.id, widgetId: widget.id } });
  await evaluateRules();
  revalidatePath(`/dashboards/${dashboard.id}`);
  return { ok: true } as const;
}

export async function toggleDashboardAlert(dashboardId: string, ruleId: string) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.manage")) return;
  const rule = await prisma.alertRule.findFirst({ where: { id: ruleId, dashboardId, userId: user.id }, select: { id: true, active: true } });
  if (!rule) return;
  await prisma.alertRule.update({ where: { id: rule.id }, data: { active: !rule.active } });
  revalidatePath(`/dashboards/${dashboardId}`);
}

export async function deleteDashboardAlert(dashboardId: string, ruleId: string) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.manage")) return;
  await prisma.alertRule.deleteMany({ where: { id: ruleId, dashboardId, userId: user.id } });
  revalidatePath(`/dashboards/${dashboardId}`);
}
