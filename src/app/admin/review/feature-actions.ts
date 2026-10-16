"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can, type PermissionAction } from "@/lib/permissions";

/** The actor, if they hold `action`; null otherwise. Every mutation names its own gate. */
async function authorized(action: PermissionAction) {
  const user = await getSessionUser();
  return user && can(user, action) ? user : null;
}

/**
 * The editorial pick for the front page and the research feed's "编辑精选" mode.
 *
 * `featuredAt` is a timestamp rather than a flag: the listings order by
 * `featuredAt desc, publishedAt desc`, so clearing it simply returns the report to the
 * chronological stream. Setting it again restamps the report as the newest pick.
 */
export async function toggleFeatured(formData: FormData) {
  const user = await authorized("admin.review");
  const articleId = formData.get("articleId")?.toString();
  const featured = formData.get("featured")?.toString();
  if (!user || !articleId || (featured !== "1" && featured !== "0")) return;
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true, title: true } });
  if (!article) return;
  const next = featured === "1";
  await prisma.article.update({ where: { id: articleId }, data: { featuredAt: next ? new Date() : null } });
  await writeAudit({
    actorId: user.id,
    action: next ? "article.feature" : "article.unfeature",
    targetType: "article",
    targetId: articleId,
    metadata: { title: article.title },
  });
  revalidatePath("/admin/review");
}
