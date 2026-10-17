import { randomUUID } from "node:crypto";
import Jimp from "jimp";
import { prisma } from "./db";
import { writeAudit } from "./audit";
import { buildNewsSlug, validateNewsInput, type NewsInput } from "./news";

/**
 * The newsroom's one write path.
 *
 * Both the console (`/admin/news` actions) and the Publisher MCP's admin tools call these
 * functions, so a news item created by an agent and one created by an operator go through
 * identical validation, slug derivation and audit entries — there is no second
 * implementation that could drift. Publishing is an explicit transition, never a side
 * effect of editing.
 */

export interface NewsIssue { code: string; message: string }
export type NewsWriteResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; issues: NewsIssue[] };

const clean = (value: string | null | undefined) => value?.trim() || null;

function auditActor(actor: { userId: string; keyId?: string }) {
  return { actorId: actor.userId, metadata: { ...(actor.keyId ? { keyId: actor.keyId } : {}) } };
}

/** Resolve the optional column a post is filed under; null clears the association. */
async function resolveColumn(slug: string | undefined): Promise<{ ok: true; id: string | null } | { ok: false; issue: NewsIssue }> {
  if (!slug?.trim()) return { ok: true, id: null };
  const column = await prisma.newsColumn.findUnique({ where: { slug: slug.trim() }, select: { id: true } });
  return column ? { ok: true, id: column.id } : { ok: false, issue: { code: "column.unknown", message: `No column with slug "${slug.trim()}".` } };
}

export async function createNewsPost(input: NewsInput, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const issues = validateNewsInput(input);
  if (issues.length) return { ok: false, issues };
  const column = await resolveColumn(input.columnSlug);
  if (!column.ok) return { ok: false, issues: [column.issue] };
  const titleZh = clean(input.titleZh);
  const titleEn = clean(input.titleEn);
  const sources = [...new Set((input.sources ?? []).map((url) => url.trim()).filter(Boolean))];
  const sourceUrl = clean(input.sourceUrl) ?? sources[0] ?? null;
  const row = await prisma.$transaction(async (tx) => {
    // The slug needs the generated id for its collision suffix, so the row is created
    // under a placeholder and renamed once, before anyone can see it (still a draft).
    const created = await tx.newsPost.create({
      data: {
        slug: `pending-${randomUUID()}`,
        kind: input.kind ?? "brief",
        titleZh,
        titleEn,
        bodyZh: clean(input.bodyZh),
        bodyEn: clean(input.bodyEn),
        sourceUrl,
        columnId: column.id,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    const slug = buildNewsSlug(titleZh ?? titleEn ?? "news", created.id);
    await tx.newsPost.update({ where: { id: created.id }, data: { slug } });
    if (sources.length) {
      await tx.newsSource.createMany({ data: sources.map((url, position) => ({ postId: created.id, url, position })) });
    }
    return { id: created.id, slug };
  });
  await writeAudit({ ...auditActor(actor), action: "news.create", targetType: "newsPost", targetId: row.id, metadata: { slug: row.slug, kind: input.kind ?? "brief", sources: sources.length, ...(input.columnSlug ? { columnSlug: input.columnSlug } : {}) } });
  return { ok: true, id: row.id, slug: row.slug };
}

export async function updateNewsPost(id: string, input: NewsInput, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) return { ok: false, issues: [{ code: "not_found", message: "No news post with that id." }] };
  const issues = validateNewsInput(input);
  if (issues.length) return { ok: false, issues };
  const column = await resolveColumn(input.columnSlug);
  if (!column.ok) return { ok: false, issues: [column.issue] };
  const sources = [...new Set((input.sources ?? []).map((url) => url.trim()).filter(Boolean))];
  const sourceUrl = clean(input.sourceUrl) ?? sources[0] ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.newsPost.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        titleZh: clean(input.titleZh),
        titleEn: clean(input.titleEn),
        bodyZh: clean(input.bodyZh),
        bodyEn: clean(input.bodyEn),
        sourceUrl,
        columnId: column.id,
      },
    });
    await tx.newsSource.deleteMany({ where: { postId: id } });
    if (sources.length) {
      await tx.newsSource.createMany({ data: sources.map((url, position) => ({ postId: id, url, position })) });
    }
  });
  await writeAudit({ ...auditActor(actor), action: "news.update", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug, sources: sources.length, ...(input.columnSlug ? { columnSlug: input.columnSlug } : {}) } });
  return { ok: true, id, slug: existing.slug };
}

export async function publishNewsPost(id: string, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true, status: true, titleZh: true, titleEn: true } });
  if (!existing) return { ok: false, issues: [{ code: "not_found", message: "No news post with that id." }] };
  const issues = validateNewsInput({ kind: "brief", titleZh: existing.titleZh ?? undefined, titleEn: existing.titleEn ?? undefined });
  if (issues.length) return { ok: false, issues };
  await prisma.newsPost.update({ where: { id }, data: { status: "published", publishedAt: new Date() } });
  await writeAudit({ ...auditActor(actor), action: "news.publish", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug } });
  return { ok: true, id, slug: existing.slug };
}

export async function unpublishNewsPost(id: string, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true, status: true } });
  if (!existing) return { ok: false, issues: [{ code: "not_found", message: "No news post with that id." }] };
  await prisma.newsPost.update({ where: { id }, data: { status: "draft" } });
  await writeAudit({ ...auditActor(actor), action: "news.unpublish", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug } });
  return { ok: true, id, slug: existing.slug };
}

export async function deleteNewsPost(id: string, actor: { userId: string; keyId?: string }): Promise<{ ok: boolean }> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true, titleZh: true } });
  if (!existing) return { ok: false };
  await prisma.newsPost.delete({ where: { id } });
  await writeAudit({ ...auditActor(actor), action: "news.delete", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug, title: existing.titleZh } });
  return { ok: true };
}

export async function setNewsPinned(id: string, pinned: boolean, actor: { userId: string; keyId?: string }): Promise<{ ok: boolean }> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) return { ok: false };
  await prisma.newsPost.update({ where: { id }, data: { pinned } });
  await writeAudit({ ...auditActor(actor), action: pinned ? "news.pin" : "news.unpin", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug } });
  return { ok: true };
}

export interface NewsColumnInput {
  slug: string;
  nameZh: string;
  nameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  cadence?: string;
}

/** Create a recurring desk. Columns are created once and then filed into by slug. */
export async function createNewsColumn(input: NewsColumnInput, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const slug = input.slug.trim().toLowerCase();
  const nameZh = input.nameZh.trim();
  const issues: NewsIssue[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 60) {
    issues.push({ code: "column.slug_invalid", message: "Column slug must be 2-60 characters of lowercase letters, digits and single hyphens." });
  }
  if (nameZh.length < 2 || nameZh.length > 80) issues.push({ code: "column.name_required", message: "A Chinese column name of 2-80 characters is required." });
  if ((input.nameEn ?? "").trim().length > 80) issues.push({ code: "column.name_en_long", message: "The English column name is too long." });
  if ((input.descriptionZh ?? "").trim().length > 500 || (input.descriptionEn ?? "").trim().length > 500) {
    issues.push({ code: "column.description_long", message: "A column description is limited to 500 characters." });
  }
  if (issues.length) return { ok: false, issues };

  try {
    const row = await prisma.newsColumn.create({
      data: {
        slug,
        nameZh,
        nameEn: clean(input.nameEn),
        descriptionZh: clean(input.descriptionZh),
        descriptionEn: clean(input.descriptionEn),
        cadence: clean(input.cadence),
      },
      select: { id: true },
    });
    await writeAudit({ ...auditActor(actor), action: "news.column.create", targetType: "newsColumn", targetId: row.id, metadata: { slug, name: nameZh } });
    return { ok: true, id: row.id, slug };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: false, issues: [{ code: "column.slug_taken", message: "A column with that slug already exists." }] };
    }
    throw error;
  }
}

async function makeThumb(data: Uint8Array) {
  try {
    const image = await Jimp.read(Buffer.from(data));
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const thumb = image.clone();
    if (thumb.bitmap.width > 360) thumb.resize(360, Jimp.AUTO);
    const thumbData = await thumb.quality(82).getBufferAsync(Jimp.MIME_JPEG);
    return { width, height, thumbData, thumbMimeType: "image/jpeg", thumbWidth: thumb.bitmap.width, thumbHeight: thumb.bitmap.height };
  } catch {
    // An image Jimp cannot decode still serves at full size; the list falls back to it.
    return null;
  }
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Attach one image to a post. The bytes live here, not in the body text. */
export async function addNewsImage(input: {
  postId: string; position: number; caption?: string; alt?: string;
  mimeType: string; width?: number; height?: number; data: Uint8Array;
}, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  if (!IMAGE_TYPES.has(input.mimeType)) return { ok: false, issues: [{ code: "image.type", message: "Images must be PNG, JPEG, WebP or GIF." }] };
  const post = await prisma.newsPost.findUnique({ where: { id: input.postId }, select: { id: true, slug: true } });
  if (!post) return { ok: false, issues: [{ code: "not_found", message: "No news post with that id." }] };
  const thumb = await makeThumb(input.data);
  const row = await prisma.newsImage.create({
    data: {
      postId: post.id,
      position: Math.max(0, Math.floor(input.position)),
      caption: clean(input.caption),
      alt: clean(input.alt),
      mimeType: input.mimeType,
      width: thumb?.width ?? input.width ?? null,
      height: thumb?.height ?? input.height ?? null,
      data: Buffer.from(input.data),
      thumbData: thumb ? Buffer.from(thumb.thumbData) : null,
      thumbMimeType: thumb?.thumbMimeType ?? null,
      thumbWidth: thumb?.thumbWidth ?? null,
      thumbHeight: thumb?.thumbHeight ?? null,
    },
    select: { id: true },
  });
  await writeAudit({ ...auditActor(actor), action: "news.image.add", targetType: "newsImage", targetId: row.id, metadata: { postId: post.id, slug: post.slug, position: input.position, mimeType: input.mimeType } });
  return { ok: true, id: row.id, slug: post.slug };
}

export async function deleteNewsImage(id: string, actor: { userId: string; keyId?: string }): Promise<{ ok: boolean }> {
  const row = await prisma.newsImage.findUnique({ where: { id }, select: { id: true, postId: true } });
  if (!row) return { ok: false };
  await prisma.newsImage.delete({ where: { id } });
  await writeAudit({ ...auditActor(actor), action: "news.image.delete", targetType: "newsImage", targetId: id, metadata: { postId: row.postId } });
  return { ok: true };
}
