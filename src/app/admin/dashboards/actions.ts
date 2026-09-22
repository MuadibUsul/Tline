"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dashboardTemplate, validWallpaperUrl } from "@/lib/dashboards";

const field = (form: FormData, key: string) => (form.get(key)?.toString() ?? "").trim();

export async function saveDashboardTemplateReview(form: FormData) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) return;
  const id = field(form, "id");
  const builtinKey = field(form, "builtinKey");
  const builtin = dashboardTemplate(builtinKey);
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(field(form, "status")) ? field(form, "status") : "PENDING";
  const data = {
    name: field(form, "name").slice(0, 80) || builtin?.nameZh || "Template",
    description: field(form, "description").slice(0, 300),
    status: builtin ? "APPROVED" : status,
    sortOrder: Math.max(-1000, Math.min(10000, Number.parseInt(field(form, "sortOrder"), 10) || 1000)),
    reviewedAt: !builtin && status === "PENDING" ? null : new Date(),
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
  revalidatePath("/dashboards/explore");
}

export async function saveDashboardBackground(form: FormData) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) return;
  const id = field(form, "id");
  const imageUrl = validWallpaperUrl(field(form, "imageUrl"));
  if (!imageUrl) return;
  const data = {
    name: field(form, "name").slice(0, 80) || "Background",
    imageUrl,
    enabled: field(form, "enabled") === "on",
    sortOrder: Math.max(-1000, Math.min(10000, Number.parseInt(field(form, "sortOrder"), 10) || 1000)),
  };
  const record = id ? await prisma.dashboardBackground.update({ where: { id }, data }) : await prisma.dashboardBackground.create({ data });
  await writeAudit({ actorId: user.id, action: "dashboard.background.save", targetType: "dashboard_background", targetId: record.id });
  revalidatePath("/admin/dashboards");
  revalidatePath("/dashboards");
}

export async function deleteDashboardBackground(form: FormData) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) return;
  const id = field(form, "id");
  if (!id) return;
  await prisma.dashboardBackground.deleteMany({ where: { id } });
  await writeAudit({ actorId: user.id, action: "dashboard.background.delete", targetType: "dashboard_background", targetId: id });
  revalidatePath("/admin/dashboards");
  revalidatePath("/dashboards");
}
