"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { announcementLink } from "@/lib/homeAnnouncement";

// The console always renders in Chinese (getAdminLocale), so redirects go straight to the
// prefixed page instead of bouncing through the language middleware's 307.
const ADMIN_PATH = "/zh/admin/announcements";

function value(formData: FormData, name: string) {
  return formData.get(name)?.toString().trim() ?? "";
}

async function authorized() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) redirect("/admin");
  return user;
}

export async function saveAnnouncementAction(formData: FormData) {
  const user = await authorized();
  const id = value(formData, "id");
  const link = announcementLink(value(formData, "href"));
  const titleEn = value(formData, "titleEn").slice(0, 120);
  const titleZh = value(formData, "titleZh").slice(0, 120);
  if (!link || !titleEn || !titleZh) redirect(`${ADMIN_PATH}?error=required`);
  const data = {
    labelEn: (value(formData, "labelEn") || "Announcement").slice(0, 24),
    labelZh: (value(formData, "labelZh") || "公告").slice(0, 24),
    titleEn,
    titleZh,
    bodyEn: value(formData, "bodyEn").slice(0, 500) || null,
    bodyZh: value(formData, "bodyZh").slice(0, 500) || null,
    href: link.href,
    active: formData.get("active") === "on",
    sortOrder: Number(value(formData, "sortOrder")) || 0,
  };
  if (id) {
    if (!(await prisma.homeAnnouncement.findUnique({ where: { id }, select: { id: true } }))) {
      redirect(`${ADMIN_PATH}?error=missing`);
    }
    await prisma.homeAnnouncement.update({ where: { id }, data });
    await writeAudit({ actorId: user.id, action: "home_announcement.update", targetType: "home_announcement", targetId: id });
  } else {
    const created = await prisma.homeAnnouncement.create({ data });
    await writeAudit({ actorId: user.id, action: "home_announcement.create", targetType: "home_announcement", targetId: created.id });
  }
  revalidatePath("/");
  revalidatePath("/admin/announcements");
  redirect(`${ADMIN_PATH}?saved=1`);
}

export async function deleteAnnouncementAction(formData: FormData) {
  const user = await authorized();
  const id = value(formData, "id");
  if (!id) return;
  const existing = await prisma.homeAnnouncement.findUnique({ where: { id }, select: { titleZh: true } });
  await prisma.homeAnnouncement.deleteMany({ where: { id } });
  await writeAudit({ actorId: user.id, action: "home_announcement.delete", targetType: "home_announcement", targetId: id, metadata: { title: existing?.titleZh } });
  revalidatePath("/");
  revalidatePath("/admin/announcements");
  redirect(`${ADMIN_PATH}?deleted=1`);
}
