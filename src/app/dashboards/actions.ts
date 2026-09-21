"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dashboardTemplate, DASHBOARD_WALLPAPERS, parseDashboardWidgets, validAccent, validWallpaperUrl } from "@/lib/dashboards";
import { describeRule } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import { getLocale, localePath } from "@/lib/i18n";

const value = (form: FormData, key: string) => (form.get(key)?.toString() ?? "").trim();

async function dashboardUser() {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) redirect(localePath(locale, "/signin?next=/dashboards"));
  return { user, locale };
}

export async function createDashboard(form: FormData) {
  const { user, locale } = await dashboardUser();
  const template = dashboardTemplate(value(form, "template"));
  const shared = !template && value(form, "templateId") ? await prisma.dashboardTemplate.findFirst({ where: { id: value(form, "templateId"), status: "APPROVED" } }) : null;
  const override = template ? await prisma.dashboardTemplate.findUnique({ where: { builtinKey: template.key } }) : null;
  const name = (value(form, "name") || shared?.name || override?.name || template?.nameZh || "自定义看板").slice(0, 80);
  const dashboard = await prisma.dashboard.create({
    data: {
      userId: user.id,
      name,
      templateKey: template?.key ?? shared?.id,
      layoutJson: shared?.layoutJson ?? JSON.stringify(template?.widgets ?? []),
      wallpaper: shared?.wallpaper ?? override?.wallpaper ?? template?.wallpaper ?? "grid",
      wallpaperUrl: shared?.wallpaperUrl ?? override?.wallpaperUrl,
      accent: shared?.accent ?? override?.accent ?? template?.accent ?? "#9e7a42",
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
  const { user, locale } = await dashboardUser();
  const id = value(form, "id");
  const deleted = await prisma.dashboard.deleteMany({ where: { id, userId: user.id } });
  if (deleted.count) await writeAudit({ actorId: user.id, action: "dashboard.delete", targetType: "dashboard", targetId: id });
  redirect(localePath(locale, "/dashboards"));
}

export async function submitDashboardTemplate(input: {
  dashboardId: string;
  name: string;
  description: string;
  coverUrl: string;
  layoutJson: string;
  wallpaper: string;
  wallpaperUrl: string;
  accent: string;
}) {
  const user = await getSessionUser();
  if (!user) return { error: "sign_in_required" } as const;
  const dashboard = await prisma.dashboard.findFirst({ where: { id: input.dashboardId, userId: user.id }, select: { id: true } });
  if (!dashboard) return { error: "not_found" } as const;
  const widgets = parseDashboardWidgets(input.layoutJson);
  if (!widgets.length) return { error: "empty_template" } as const;
  const saved = await prisma.dashboardTemplate.upsert({
    where: { sourceDashboardId: dashboard.id },
    create: {
      sourceDashboardId: dashboard.id, authorId: user.id, name: input.name.trim().slice(0, 80) || "Dashboard template",
      description: input.description.trim().slice(0, 300), coverUrl: validWallpaperUrl(input.coverUrl), layoutJson: JSON.stringify(widgets),
      wallpaper: (DASHBOARD_WALLPAPERS as readonly string[]).includes(input.wallpaper) ? input.wallpaper : "grid",
      wallpaperUrl: validWallpaperUrl(input.wallpaperUrl), accent: validAccent(input.accent), status: "PENDING",
    },
    update: {
      name: input.name.trim().slice(0, 80) || "Dashboard template", description: input.description.trim().slice(0, 300),
      coverUrl: validWallpaperUrl(input.coverUrl), layoutJson: JSON.stringify(widgets), wallpaper: (DASHBOARD_WALLPAPERS as readonly string[]).includes(input.wallpaper) ? input.wallpaper : "grid",
      wallpaperUrl: validWallpaperUrl(input.wallpaperUrl), accent: validAccent(input.accent), status: "PENDING", submittedAt: new Date(), reviewedAt: null,
    },
  });
  await writeAudit({ actorId: user.id, action: "dashboard.template.submit", targetType: "dashboard_template", targetId: saved.id, metadata: { dashboardId: dashboard.id, widgets: widgets.length } });
  revalidatePath(`/dashboards/${dashboard.id}`);
  revalidatePath("/admin/dashboards");
  return { ok: true, status: "PENDING" } as const;
}

export async function createDashboardAlert(input: {
  dashboardId: string;
  layoutJson: string;
  widgetId: string;
  type: string;
  threshold: number;
}) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.alerts")) return { error: "upgrade_required" } as const;
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
  revalidatePath(`/dashboards/${dashboard.id}`);
  return { ok: true } as const;
}

export async function toggleDashboardAlert(dashboardId: string, ruleId: string) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.alerts")) return;
  const rule = await prisma.alertRule.findFirst({ where: { id: ruleId, dashboardId, userId: user.id }, select: { id: true, active: true } });
  if (!rule) return;
  await prisma.alertRule.update({ where: { id: rule.id }, data: { active: !rule.active } });
  revalidatePath(`/dashboards/${dashboardId}`);
}

export async function deleteDashboardAlert(dashboardId: string, ruleId: string) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.alerts")) return;
  await prisma.alertRule.deleteMany({ where: { id: ruleId, dashboardId, userId: user.id } });
  revalidatePath(`/dashboards/${dashboardId}`);
}
