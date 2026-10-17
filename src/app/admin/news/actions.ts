"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { can, type PermissionAction } from "@/lib/permissions";
import type { NewsInput } from "@/lib/news";
import {
  addNewsImage,
  createNewsColumn,
  createNewsPost,
  deleteNewsImage,
  deleteNewsPost,
  publishNewsPost,
  setNewsPinned,
  unpublishNewsPost,
  updateNewsPost,
} from "@/lib/newsAdmin";

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
    columnSlug: value("columnSlug"),
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

export async function createNewsColumnAction(_previous: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await authorized("admin.review");
  if (!user) return { error: "无权执行此操作。" };
  const value = (name: string) => formData.get(name)?.toString();
  const result = await createNewsColumn({
    slug: value("slug") ?? "",
    nameZh: value("nameZh") ?? "",
    nameEn: value("nameEn"),
    descriptionZh: value("descriptionZh"),
    descriptionEn: value("descriptionEn"),
    cadence: value("cadence"),
  }, { userId: user.id });
  if (!result.ok) return { issues: result.issues };
  revalidatePath("/admin/news");
  revalidatePath("/admin/news/columns");
  redirect("/admin/news/columns");
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export async function addNewsImageAction(_previous: NewsFormState, formData: FormData): Promise<NewsFormState> {
  const user = await authorized("admin.review");
  if (!user) return { error: "无权执行此操作。" };
  const postId = formData.get("postId")?.toString();
  const file = formData.get("image");
  if (!postId) return { error: "缺少条目。" };
  if (!(file instanceof File) || file.size === 0) return { error: "请选择一张图片。" };
  if (file.size > IMAGE_MAX_BYTES) return { error: "图片不能超过 8MB。" };
  if (!IMAGE_TYPES.has(file.type)) return { error: "仅支持 PNG、JPEG、WebP 或 GIF。" };
  const buffer = Buffer.from(await file.arrayBuffer());
  // Validate the bytes, not the browser-supplied mime: a renamed HTML file must not be
  // served from the image route. Dimensions are optional here; the browser sizes the img.
  const signature = file.type === "image/png"
    ? buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    : file.type === "image/jpeg"
      ? buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : file.type === "image/gif"
        ? buffer.length > 6 && buffer.toString("ascii", 0, 4) === "GIF8"
        : buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!signature) return { error: "文件内容与图片格式不符。" };
  const position = Number(formData.get("position") ?? 0);
  const result = await addNewsImage({
    postId,
    position: Number.isFinite(position) ? position : 0,
    caption: formData.get("caption")?.toString(),
    alt: formData.get("alt")?.toString(),
    mimeType: file.type,
    data: buffer,
  }, { userId: user.id });
  if (!result.ok) return { issues: result.issues };
  revalidatePath(`/admin/news/${postId}`);
  const slug = formData.get("slug")?.toString();
  if (slug) revalidatePath(`/news/${slug}`);
  return {};
}

export async function deleteNewsImageAction(formData: FormData) {
  const user = await authorized("admin.review");
  const id = formData.get("id")?.toString();
  const postId = formData.get("postId")?.toString();
  if (!user || !id || !postId) return;
  await deleteNewsImage(id, { userId: user.id });
  revalidatePath(`/admin/news/${postId}`);
  const slug = formData.get("slug")?.toString();
  if (slug) revalidatePath(`/news/${slug}`);
}
