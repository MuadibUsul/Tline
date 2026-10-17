import { randomUUID } from "node:crypto";
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

export async function createNewsPost(input: NewsInput, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const issues = validateNewsInput(input);
  if (issues.length) return { ok: false, issues };
  const titleZh = clean(input.titleZh);
  const titleEn = clean(input.titleEn);
  const row = await prisma.newsPost.create({
    data: {
      // The slug needs the generated id for its collision suffix, so the row is created
      // under a placeholder and renamed once, before anyone can see it (still a draft).
      slug: `pending-${randomUUID()}`,
      kind: input.kind ?? "brief",
      titleZh,
      titleEn,
      bodyZh: clean(input.bodyZh),
      bodyEn: clean(input.bodyEn),
      sourceUrl: clean(input.sourceUrl),
      createdById: actor.userId,
    },
    select: { id: true },
  });
  const slug = buildNewsSlug(titleZh ?? titleEn ?? "news", row.id);
  await prisma.newsPost.update({ where: { id: row.id }, data: { slug } });
  await writeAudit({ ...auditActor(actor), action: "news.create", targetType: "newsPost", targetId: row.id, metadata: { slug, kind: input.kind ?? "brief" } });
  return { ok: true, id: row.id, slug };
}

export async function updateNewsPost(id: string, input: NewsInput, actor: { userId: string; keyId?: string }): Promise<NewsWriteResult> {
  const existing = await prisma.newsPost.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) return { ok: false, issues: [{ code: "not_found", message: "No news post with that id." }] };
  const issues = validateNewsInput(input);
  if (issues.length) return { ok: false, issues };
  await prisma.newsPost.update({
    where: { id },
    data: {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      titleZh: clean(input.titleZh),
      titleEn: clean(input.titleEn),
      bodyZh: clean(input.bodyZh),
      bodyEn: clean(input.bodyEn),
      sourceUrl: clean(input.sourceUrl),
    },
  });
  await writeAudit({ ...auditActor(actor), action: "news.update", targetType: "newsPost", targetId: id, metadata: { slug: existing.slug } });
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
