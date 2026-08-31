"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";

async function admin() {
  const user = await getSessionUser();
  return user && can(user, "admin.review") ? user : null;
}

export async function setSourceMonitoring(formData: FormData) {
  const user = await admin();
  const id = formData.get("id")?.toString();
  const enabled = formData.get("enabled") === "true";
  if (!user || !id) return;
  const source = await prisma.institution.findUnique({ where: { id }, select: { id: true, name: true, crawlPolicy: true } });
  if (!source) return;
  await prisma.institution.update({
    where: { id },
    data: {
      monitoringEnabled: enabled,
      ...(!enabled ? { lastCrawlStatus: "paused", lastCrawlMessage: "Paused by operations." } : {}),
    },
  });
  await writeAudit({ actorId: user.id, action: enabled ? "source.monitoring.resume" : "source.monitoring.pause", targetType: "institution", targetId: id, metadata: { name: source.name, crawlPolicy: source.crawlPolicy } });
  revalidatePath("/admin");
}

export async function queueSourceRetry(formData: FormData) {
  const user = await admin();
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  const source = await prisma.institution.findUnique({ where: { id }, select: { id: true, name: true, crawlPolicy: true } });
  if (!source || !["allowed", "delayed"].includes(source.crawlPolicy)) return;
  await prisma.institution.update({
    where: { id },
    data: { monitoringEnabled: true, lastCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "Queued for the next scheduler pass." },
  });
  await writeAudit({ actorId: user.id, action: "source.retry.queue", targetType: "institution", targetId: id, metadata: { name: source.name } });
  revalidatePath("/admin");
}
