"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dashboardTemplate, DASHBOARD_TEMPLATES, DASHBOARD_WALLPAPERS, parseDashboardWidgets, validAccent, validWallpaperUrl } from "@/lib/dashboards";
import { describeRule } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import { getLocale, localePath } from "@/lib/i18n";
import { taxonomy } from "@/lib/classification/taxonomy";
import { resolveLLMProvider } from "@/lib/llm/config";
import { completeJSON } from "@/lib/llm/provider";
import type { DashboardWidget, DashboardWidgetType } from "@/lib/dashboards";

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
  const dashboard = await prisma.$transaction(async (tx) => {
    const created = await tx.dashboard.create({ data: {
      userId: user.id,
      name,
      templateKey: template?.key ?? shared?.id,
      layoutJson: shared?.layoutJson ?? JSON.stringify(template?.widgets ?? []),
      wallpaper: shared ? "grid" : override?.wallpaper ?? template?.wallpaper ?? "grid",
      wallpaperUrl: shared ? null : override?.wallpaperUrl,
      accent: shared?.accent ?? override?.accent ?? template?.accent ?? "#9e7a42",
    } });
    if (shared) await tx.dashboardTemplate.update({ where: { id: shared.id }, data: { useCount: { increment: 1 } } });
    return created;
  });
  await writeAudit({ actorId: user.id, action: "dashboard.create", targetType: "dashboard", targetId: dashboard.id, metadata: { template: template?.key ?? "custom" } });
  redirect(localePath(locale, `/dashboards/${dashboard.id}`));
}

type DashboardSuggestion = { type?: string; title?: string; ref?: string; scopeKind?: string };

export async function generateDashboardLayout(input: { dashboardId: string; prompt: string; locale: "en" | "zh-CN" }) {
  const user = await getSessionUser();
  if (!user || !can(user, "dashboards.manage")) return { error: "sign_in_required" } as const;
  const prompt = input.prompt.trim().slice(0, 600);
  if (prompt.length < 4) return { error: "describe_your_needs" } as const;
  const dashboard = await prisma.dashboard.findFirst({ where: { id: input.dashboardId, userId: user.id }, select: { id: true } });
  if (!dashboard) return { error: "not_found" } as const;

  const [assets, indicators] = await Promise.all([
    prisma.asset.findMany({ orderBy: { ticker: "asc" }, take: 160, select: { ticker: true, name: true } }),
    prisma.macroIndicator.findMany({ where: { enabled: true }, orderBy: { canonicalKey: "asc" }, take: 240, select: { canonicalKey: true, nameEn: true, nameZh: true } }),
  ]);
  const assetRefs = new Set(assets.map((item) => item.ticker.toUpperCase()));
  const indicatorRefs = new Set(indicators.map((item) => item.canonicalKey));
  const institutionRefs = new Set(taxonomy.institutions.map((item) => item.key));
  const topicRefs = new Set(taxonomy.topics.map((item) => item.key));
  const catalog = {
    assets: assets.map((item) => `${item.ticker}:${item.name}`),
    indicators: indicators.map((item) => `${item.canonicalKey}:${input.locale === "zh-CN" ? item.nameZh ?? item.nameEn : item.nameEn}`),
    institutions: taxonomy.institutions.map((item) => `${item.key}:${input.locale === "zh-CN" ? item.nameZh : item.nameEn}`),
    topics: taxonomy.topics.map((item) => `${item.key}:${input.locale === "zh-CN" ? item.nameZh : item.nameEn}`),
  };
  let suggestions: DashboardSuggestion[] = [];
  let generatedName = "";
  let usedAI = false;
  const provider = await resolveLLMProvider("analysis");
  if (provider) {
    try {
      const result = await completeJSON<{ name?: string; widgets?: DashboardSuggestion[] }>(provider, {
        system: "You design institutional market-monitoring dashboards. Return JSON only: {name,widgets:[{type,title,ref,scopeKind}]}. Use 3-8 widgets. type must be market, macro, or research. Every ref must be copied exactly from the supplied catalog. research scopeKind must be asset, institution, or topic. Prefer live data and one research card. Never invent a source.",
        user: `Request: ${prompt}\nSupported catalog: ${JSON.stringify(catalog)}`,
        maxTokens: 900,
        audit: { contentId: dashboard.id, promptVersion: "dashboard-layout-v1", executionLevel: "LEVEL_2", contextStrategy: "STRUCTURED", cacheStatus: "NOT_APPLICABLE", reasonCodes: ["USER_REQUESTED_DASHBOARD_LAYOUT"] },
      });
      suggestions = Array.isArray(result.value.widgets) ? result.value.widgets.slice(0, 8) : [];
      generatedName = typeof result.value.name === "string" ? result.value.name.trim().slice(0, 80) : "";
      usedAI = true;
    } catch {
      // A useful, fully validated fallback is better than leaving the canvas unchanged.
    }
  }
  const normalized: Array<{ type: DashboardWidgetType; title: string; ref: string; scopeKind?: "asset" | "institution" | "topic" }> = [];
  for (const item of suggestions) {
    const type = item.type as DashboardWidgetType;
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 100) : ref;
    if (type === "market" && assetRefs.has(ref.toUpperCase())) normalized.push({ type, ref: ref.toUpperCase(), title: title || ref });
    else if (type === "macro" && indicatorRefs.has(ref)) normalized.push({ type, ref, title: title || ref });
    else if (type === "research") {
      const scopeKind = item.scopeKind === "institution" ? "institution" : item.scopeKind === "topic" ? "topic" : "asset";
      const valid = scopeKind === "asset" ? assetRefs.has(ref.toUpperCase()) : scopeKind === "institution" ? institutionRefs.has(ref) : topicRefs.has(ref);
      if (valid) normalized.push({ type, ref: scopeKind === "asset" ? ref.toUpperCase() : ref, title: title || ref, scopeKind });
    }
  }
  if (!normalized.length) {
    const query = prompt.toLocaleLowerCase();
    const aliases: Record<string, string[]> = { fed: ["fed", "fomc", "美联储"], inflation: ["inflation", "cpi", "pce", "通胀"], employment: ["employment", "payroll", "unemployment", "就业", "非农"], oil: ["oil", "wti", "原油"], boj: ["boj", "日本央行", "日元"], boe: ["boe", "英国央行", "英镑"], gold: ["gold", "xau", "黄金"] };
    const matchedPresets = DASHBOARD_TEMPLATES.filter((item) => aliases[item.key]?.some((term) => query.includes(term)));
    for (const preset of matchedPresets) for (const item of preset.widgets) {
      const valid = item.type === "market" ? !!item.ref && assetRefs.has(item.ref.toUpperCase())
        : item.type === "macro" ? !!item.ref && indicatorRefs.has(item.ref)
          : item.type === "research" ? !!item.ref && (item.scopeKind === "institution" ? institutionRefs.has(item.ref) : item.scopeKind === "topic" ? topicRefs.has(item.ref) : assetRefs.has(item.ref.toUpperCase())) : false;
      if (valid && item.ref && !normalized.some((row) => row.type === item.type && row.ref === item.ref)) normalized.push({ type: item.type, ref: item.ref, title: item.title, scopeKind: item.scopeKind });
      if (normalized.length >= 8) break;
    }
    if (!generatedName && matchedPresets.length === 1) generatedName = input.locale === "zh-CN" ? matchedPresets[0].nameZh : matchedPresets[0].nameEn;
    const matches = indicators.filter((item) => `${item.canonicalKey} ${item.nameEn} ${item.nameZh ?? ""}`.toLocaleLowerCase().split(/[_\s/-]+/).some((part) => (part.length > 2 || /[^\x00-\x7f]/i.test(part)) && query.includes(part))).slice(0, 5);
    const asset = assets.find((item) => query.includes(item.ticker.toLocaleLowerCase()) || query.includes(item.name.toLocaleLowerCase()));
    if (asset) normalized.push({ type: "market", ref: asset.ticker, title: asset.name });
    normalized.push(...matches.map((item) => ({ type: "macro" as const, ref: item.canonicalKey, title: input.locale === "zh-CN" ? item.nameZh ?? item.nameEn : item.nameEn })));
    const topic = taxonomy.topics.find((item) => query.includes(item.nameZh.toLocaleLowerCase()) || query.includes(item.nameEn.toLocaleLowerCase()));
    if (topic) normalized.push({ type: "research", ref: topic.key, title: input.locale === "zh-CN" ? `${topic.nameZh}研报` : `${topic.nameEn} research`, scopeKind: "topic" });
    if (!normalized.length) return { error: provider ? "no_supported_sources" : "ai_unavailable" } as const;
  }
  const widgets: DashboardWidget[] = normalized.slice(0, 8).map((item, index) => ({
    id: `ai-${Date.now()}-${index + 1}`, type: item.type, title: item.title, ref: item.ref, scopeKind: item.scopeKind,
    x: 60 + (index % 3) * 390, y: 60 + Math.floor(index / 3) * 285, w: 360, h: item.type === "research" ? 270 : 235,
  }));
  await prisma.dashboard.update({ where: { id: dashboard.id }, data: { layoutJson: JSON.stringify(widgets), ...(generatedName ? { name: generatedName } : {}) } });
  await writeAudit({ actorId: user.id, action: "dashboard.ai_layout.generate", targetType: "dashboard", targetId: dashboard.id, metadata: { prompt, widgets: widgets.length, usedAI } });
  revalidatePath(`/dashboards/${dashboard.id}`);
  return { ok: true, widgets, name: generatedName, usedAI } as const;
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
      wallpaper: "grid", wallpaperUrl: null, accent: validAccent(input.accent), status: "PENDING",
    },
    update: {
      name: input.name.trim().slice(0, 80) || "Dashboard template", description: input.description.trim().slice(0, 300),
      coverUrl: validWallpaperUrl(input.coverUrl), layoutJson: JSON.stringify(widgets), wallpaper: "grid",
      wallpaperUrl: null, accent: validAccent(input.accent), status: "PENDING", submittedAt: new Date(), reviewedAt: null,
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
