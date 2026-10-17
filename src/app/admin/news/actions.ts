"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { can, type PermissionAction } from "@/lib/permissions";
import type { NewsInput } from "@/lib/news";
import { createNewsPost, deleteNewsPost, publishNewsPost, setNewsPinned, unpublishNewsPost, updateNewsPost } from "@/lib/newsAdmin";

/**
 * The console's newsroom actions. Every one of them is a thin wrapper around
 * lib/newsAdmin — the same functions the Publisher MCP's admin tools call — so the
 * validation, slug derivation and audit entries cannot differ by entry point.
 */

export interface NewsFormState {
  error?: string;
  issues?: Array<{ code: string; message: string }>;
}

async function authorized(action: PermissionAction) {
  const user = await getSessionUser();
  return user && can(user, action) ? user : null;
}

function readInput(formData: FormData): NewsInput {
  const value = (name: string) => formData.get(name)?.toString();
  return {
    kind: value("kind"),
    titleZh: value("titleZh"),
    titleEn: value("titleEn"),
    bodyZh: value("bodyZh"),
    bodyEn: value("bodyEn"),
    sourceUrl: value("sourceUrl"),
  };
}

function refresh(id: string | undefined) {
  revalidatePath("/news");
  revalidatePath("/admin/news");
  if (id) revalidatePath(`/admin/news/${id}`);
}

export async function createNewsAction(_previous: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await authorized("admin.review");
  if (!user) return { error: "无权执行此操作。" };
  const result = await createNewsPost(readInput(formData), { userId: user.id });
  if (!result.ok) return { issues: result.issues };
  refresh(result.id);
  redirect(`/admin/news/${result.id}?created=1`);
}

export async function updateNewsAction(_previous: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await authorized("admin.review");
  if (!user) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "缺少条目。" };
  const result = await updateNewsPost(id, readInput(formData), { userId: user.id });
  if (!result.ok) return { issues: result.issues };
  refresh(id);
  return {};
}

export async function publishNewsAction(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  await publishNewsPost(id, { userId: user.id });
  refresh(id);
}

export async function unpublishNewsAction(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  await unpublishNewsPost(id, { userId: user.id });
  refresh(id);
}

export async function deleteNewsAction(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  await deleteNewsPost(id, { userId: user.id });
  refresh(id);
  if (formData.get("from") === "edit") redirect("/admin/news");
}

export async function pinNewsAction(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("id")?.toString();
  if (!user || !id) return;
  await setNewsPinned(id, formData.get("pinned") === "1", { userId: user.id });
  refresh(id);
}
