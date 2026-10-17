import { revalidatePath } from "next/cache";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, toolGuard } from "./results";
import { prisma } from "../db";
import { writeAudit } from "../audit";
import { can, type PermissionAction } from "../permissions";
import { createNewsPost, deleteNewsPost, publishNewsPost, setNewsPinned, unpublishNewsPost, updateNewsPost, type NewsWriteResult } from "../newsAdmin";
import type { McpAuthContext } from "./auth";

/**
 * The operations tools: the owner's standing goal is that an agent can run the site over
 * MCP, so this is the console's operational surface, not a new one. Every tool checks two
 * things per call — the key carries `admin:manage`, and the key's account still holds the
 * same permission the console requires for that action (`can(owner, action)`) — and every
 * mutation lands an audit entry through the same helpers the console uses. An agent key is
 * therefore exactly as powerful as the account it belongs to, never more, and a demoted or
 * suspended account loses the power on the next request.
 */

type Actor = { userId: string; keyId: string };

export interface ArticleRef { articleId?: string; slug?: string }

export interface OpsToolDeps {
  resolveArticle: (ref: ArticleRef) => Promise<{ id: string; slug: string; title: string; withdrawnAt: Date | null; featuredAt: Date | null } | null>;
  setArticleWithdrawn: (id: string, withdrawn: boolean, actor: Actor, reason?: string) => Promise<void>;
  setArticleFeatured: (id: string, featured: boolean, actor: Actor) => Promise<void>;
  setSourceMonitoring: (slug: string, enabled: boolean, actor: Actor) => Promise<boolean>;
  createNews: typeof createNewsPost;
  updateNews: typeof updateNewsPost;
  publishNews: typeof publishNewsPost;
  unpublishNews: typeof unpublishNewsPost;
  deleteNews: typeof deleteNewsPost;
  pinNews: typeof setNewsPinned;
  listNews: (status: string | undefined, limit: number) => Promise<Array<{ id: string; slug: string; kind: string; titleZh: string | null; titleEn: string | null; status: string; pinned: boolean; publishedAt: Date | null }>>;
}

export const defaultOpsDeps: OpsToolDeps = {
  resolveArticle: ({ articleId, slug }) =>
    prisma.article.findFirst({
      where: articleId ? { id: articleId } : { slug },
      select: { id: true, slug: true, title: true, withdrawnAt: true, featuredAt: true },
    }),
  setArticleWithdrawn: async (id, withdrawn, actor, reason) => {
    await prisma.article.update({ where: { id }, data: { withdrawnAt: withdrawn ? new Date() : null } });
    await writeAudit({ actorId: actor.userId, action: withdrawn ? "article.withdraw" : "article.restore", targetType: "article", targetId: id, metadata: { keyId: actor.keyId, ...(reason ? { reason } : {}) } });
    revalidatePath("/research");
    revalidatePath("/");
  },
  setArticleFeatured: async (id, featured, actor) => {
    await prisma.article.update({ where: { id }, data: { featuredAt: featured ? new Date() : null } });
    await writeAudit({ actorId: actor.userId, action: featured ? "article.feature" : "article.unfeature", targetType: "article", targetId: id, metadata: { keyId: actor.keyId } });
    revalidatePath("/research");
    revalidatePath("/");
  },
  setSourceMonitoring: async (slug, enabled, actor) => {
    const source = await prisma.institution.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!source) return false;
    await prisma.institution.update({
      where: { id: source.id },
      data: {
        monitoringEnabled: enabled,
        ...(enabled ? { consecutiveFailures: 0, nextCrawlAt: null, lastCrawlStatus: "queued", lastCrawlMessage: "已由 MCP 恢复监控。" } : {}),
        ...(!enabled ? { lastCrawlStatus: "paused", lastCrawlMessage: "已由 MCP 暂停监控。" } : {}),
      },
    });
    await writeAudit({ actorId: actor.userId, action: enabled ? "source.monitoring.resume" : "source.monitoring.pause", targetType: "institution", targetId: source.id, metadata: { keyId: actor.keyId, name: source.name } });
    revalidatePath("/admin/sources");
    return true;
  },
  createNews: createNewsPost,
  updateNews: updateNewsPost,
  publishNews: publishNewsPost,
  unpublishNews: unpublishNewsPost,
  deleteNews: deleteNewsPost,
  pinNews: setNewsPinned,
  listNews: (status, limit) =>
    prisma.newsPost.findMany({
      where: status ? { status } : {},
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, slug: true, kind: true, titleZh: true, titleEn: true, status: true, pinned: true, publishedAt: true },
    }),
};

const ARTICLE_REF = {
  articleId: z.string().optional().describe("Article id, when known."),
  slug: z.string().optional().describe("Article slug, as an alternative to the id."),
} as const;

const NEWS_FIELDS = {
  kind: z.enum(["article", "brief", "flash"]).optional().describe("article | brief | flash; defaults to brief."),
  titleZh: z.string().max(300).optional(),
  titleEn: z.string().max(300).optional(),
  bodyZh: z.string().max(40_000).optional().describe("Chinese body; blank lines separate paragraphs."),
  bodyEn: z.string().max(40_000).optional(),
  sourceUrl: z.string().max(2000).optional().describe("HTTPS source link."),
} as const;

/** Translate a news domain result into the MCP envelope. */
function newsSettled(result: NewsWriteResult) {
  if (!result.ok) return fail("VALIDATION_FAILED", "The news item did not pass validation.", { issues: result.issues });
  return ok({ id: result.id, slug: result.slug });
}

export function registerOpsTools(server: McpServer, context: McpAuthContext, deps: OpsToolDeps = defaultOpsDeps) {
  const actor: Actor = { userId: context.actorId, keyId: context.key.id };
  const authorized = (action: PermissionAction) => can(context.owner, action);

  /** Both gates every ops tool shares: the capability scope, then the live account permission. */
  const gate = (action: PermissionAction): ReturnType<typeof fail> | null => {
    if (!context.key.scopes.includes("admin:manage")) {
      return fail("SCOPE_DENIED", "This key lacks the admin:manage scope; ask an operator to issue a key carrying it.");
    }
    if (!authorized(action)) {
      return fail("SCOPE_DENIED", "The account this key belongs to no longer holds the permission this action needs.");
    }
    return null;
  };

  const resolve = async (ref: ArticleRef) => {
    if (!ref.articleId && !ref.slug) return null;
    return deps.resolveArticle(ref);
  };

  server.registerTool("withdraw_research", {
    title: "Withdraw a research report",
    description: "Take a report down everywhere the site publishes it — page, sitemap, RSS, API, listings, MCP — by stamping withdrawnAt. Reversible with restore_research. Requires the admin:manage scope on a reviewer or admin key.",
    inputSchema: { ...ARTICLE_REF, reason: z.string().max(300).optional().describe("Why it was taken down; recorded in the audit log.") },
    outputSchema: { id: z.string(), slug: z.string(), withdrawn: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, toolGuard("withdraw_research", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const article = await resolve(args);
    if (!article) return fail("NOT_FOUND", "No article matches that id or slug.");
    await deps.setArticleWithdrawn(article.id, true, actor, args.reason);
    return ok({ id: article.id, slug: article.slug, withdrawn: true });
  }));

  server.registerTool("restore_research", {
    title: "Restore a withdrawn report",
    description: "Clear withdrawnAt so the report returns to every public surface — subject, as always, to the publication gate's verdict.",
    inputSchema: ARTICLE_REF,
    outputSchema: { id: z.string(), slug: z.string(), withdrawn: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("restore_research", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const article = await resolve(args);
    if (!article) return fail("NOT_FOUND", "No article matches that id or slug.");
    await deps.setArticleWithdrawn(article.id, false, actor);
    return ok({ id: article.id, slug: article.slug, withdrawn: false });
  }));

  server.registerTool("feature_research", {
    title: "Feature or unfeature a report",
    description: "Set or clear the editorial pick that leads the research feed and the front page.",
    inputSchema: { ...ARTICLE_REF, featured: z.boolean().describe("true to feature, false to unfeature.") },
    outputSchema: { id: z.string(), slug: z.string(), featured: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("feature_research", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const article = await resolve(args);
    if (!article) return fail("NOT_FOUND", "No article matches that id or slug.");
    await deps.setArticleFeatured(article.id, args.featured, actor);
    return ok({ id: article.id, slug: article.slug, featured: args.featured });
  }));

  server.registerTool("set_source_monitoring", {
    title: "Enable or pause a source",
    description: "Turn the crawler on or off for one institution. Enabling also clears the failure backoff and queues an immediate crawl. Requires an admin account (admin.sources).",
    inputSchema: { institutionSlug: z.string().describe("Institution slug, e.g. ubs."), enabled: z.boolean() },
    outputSchema: { institutionSlug: z.string(), enabled: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("set_source_monitoring", async (args) => {
    const denied = gate("admin.sources");
    if (denied) return denied;
    const done = await deps.setSourceMonitoring(args.institutionSlug, args.enabled, actor);
    if (!done) return fail("NOT_FOUND", "No institution with that slug.");
    return ok({ institutionSlug: args.institutionSlug, enabled: args.enabled });
  }));

  server.registerTool("create_news", {
    title: "Create a news item",
    description: "Write a newsroom item (article, brief or flash) as a draft. At least one language needs a title; a flash may be title-only. Publish it with publish_news.",
    inputSchema: NEWS_FIELDS,
    outputSchema: { id: z.string(), slug: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, toolGuard("create_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    return newsSettled(await deps.createNews(args, actor));
  }));

  server.registerTool("update_news", {
    title: "Update a news item",
    description: "Replace the fields of an existing item. The slug never changes.",
    inputSchema: { id: z.string().describe("News item id."), ...NEWS_FIELDS },
    outputSchema: { id: z.string(), slug: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, toolGuard("update_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const { id, ...fields } = args;
    return newsSettled(await deps.updateNews(id, fields, actor));
  }));

  server.registerTool("publish_news", {
    title: "Publish a news item",
    description: "Make a draft public at /news and its permalink. Idempotent; publishing an already-published item refreshes publishedAt.",
    inputSchema: { id: z.string() },
    outputSchema: { id: z.string(), slug: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("publish_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    return newsSettled(await deps.publishNews(args.id, actor));
  }));

  server.registerTool("unpublish_news", {
    title: "Unpublish a news item",
    description: "Return a published item to draft; its permalink stops resolving.",
    inputSchema: { id: z.string() },
    outputSchema: { id: z.string(), slug: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("unpublish_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    return newsSettled(await deps.unpublishNews(args.id, actor));
  }));

  server.registerTool("delete_news", {
    title: "Delete a news item",
    description: "Delete an item permanently. The audit log keeps the id, slug and title; the item itself is gone.",
    inputSchema: { id: z.string() },
    outputSchema: { id: z.string(), deleted: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, toolGuard("delete_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const done = await deps.deleteNews(args.id, actor);
    return done.ok ? ok({ id: args.id, deleted: true }) : fail("NOT_FOUND", "No news item with that id.");
  }));

  server.registerTool("pin_news", {
    title: "Pin or unpin a news item",
    description: "Pinned items lead the newsroom stream.",
    inputSchema: { id: z.string(), pinned: z.boolean() },
    outputSchema: { id: z.string(), pinned: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("pin_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const done = await deps.pinNews(args.id, args.pinned, actor);
    return done.ok ? ok({ id: args.id, pinned: args.pinned }) : fail("NOT_FOUND", "No news item with that id.");
  }));

  server.registerTool("list_news", {
    title: "List news items",
    description: "The newsroom desk: drafts and published items, pinned first then newest.",
    inputSchema: { status: z.enum(["draft", "published"]).optional(), limit: z.number().int().min(1).max(100).optional() },
    outputSchema: {
      items: z.array(z.object({
        id: z.string(), slug: z.string(), kind: z.string(),
        titleZh: z.string().nullable(), titleEn: z.string().nullable(),
        status: z.string(), pinned: z.boolean(), publishedAt: z.string().nullable(),
      })),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("list_news", async (args) => {
    const denied = gate("admin.review");
    if (denied) return denied;
    const items = await deps.listNews(args.status, args.limit ?? 20);
    return ok({ items: items.map((item) => ({ ...item, publishedAt: item.publishedAt?.toISOString() ?? null })) });
  }));
}
