"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dashboardTemplate, DASHBOARD_WALLPAPERS, validAccent, validWallpaperUrl } from "@/lib/dashboards";

const field = (form: FormData, key: string) => (form.get(key)?.toString() ?? "").trim();

export async function saveDashboardTemplateReview(form: FormData) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) return;
  const id = field(form, "id");
  const builtinKey = field(form, "builtinKey");
  const builtin = dashboardTemplate(builtinKey);
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(field(form, "status")) ? field(form, "status") : "PENDING";
  const wallpaper = (DASHBOARD_WALLPAPERS as readonly string[]).includes(field(form, "wallpaper")) ? field(form, "wallpaper") : "grid";
  const accent = validAccent(field(form, "accent"));
  const data = {
    name: field(form, "name").slice(0, 80) || builtin?.nameZh || "Template",
    description: field(form, "description").slice(0, 300),
    coverUrl: validWallpaperUrl(field(form, "coverUrl")), wallpaper,
    wallpaperUrl: validWallpaperUrl(field(form, "wallpaperUrl")), accent,
    status: builtin ? "APPROVED" : status,
    sortOrder: Math.max(-1000, Math.min(10000, Number.parseInt(field(form, "sortOrder"), 10) || 1000)),
    reviewedAt: status === "PENDING" && !builtin ? null : new Date(),
  };
  let templateId = id;
  if (builtin) {
    const record = await prisma.dashboardTemplate.upsert({
      where: { builtinKey: builtin.key },
      create: { builtinKey: builtin.key, layoutJson: JSON.stringify(builtin.widgets), ...data },
      update: { layoutJson: JSON.stringify(builtin.widgets), ...data },
    });
    templateId = record.id;
  } else if (id) {
    await prisma.dashboardTemplate.updateMany({ where: { id, builtinKey: null }, data });
  } else return;
  await writeAudit({ actorId: user.id, action: "dashboard.template.review", targetType: "dashboard_template", targetId: templateId, metadata: { status: data.status, builtinKey: builtin?.key ?? null } });
  revalidatePath("/admin/dashboards");
  revalidatePath("/dashboards");
}
