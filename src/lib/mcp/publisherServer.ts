import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, toolGuard } from "./results";
import { createDraft, listDrafts, publishDraft, submitDraft, updateDraft, validateDraft, type DraftOutcome } from "./publicationDrafts";
import type { McpAuthContext } from "./auth";
import { defaultOpsDeps, registerOpsTools, type OpsToolDeps } from "./opsServer";

/**
 * The Tline Publisher MCP: draft creation, submission and — for keys carrying the
 * `publisher:publish` scope — direct publishing.
 *
 * The blast radius is bounded by construction: publishing is a scope of its own, checked
 * per tool call; the published article goes through the same derive-and-store path the
 * crawler uses and is judged by the same public gate, so a publish that fails validation
 * or the gate is reported as withheld rather than forced live. Site operations — taking
 * reports down, editorial picks, source monitoring and the newsroom — sit behind a
 * separate `admin:manage` scope and the account's own live permission, so a drafting key
 * and an operating key stay distinguishable.
 */

export interface PublisherToolDeps {
  createDraft: typeof createDraft;
  updateDraft: typeof updateDraft;
  validateDraft: typeof validateDraft;
  submitDraft: typeof submitDraft;
  publishDraft: typeof publishDraft;
  listDrafts: typeof listDrafts;
}

export const defaultPublisherDeps: PublisherToolDeps = { createDraft, updateDraft, validateDraft, submitDraft, publishDraft, listDrafts };

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const IDEMPOTENT_WRITE = { ...WRITE, idempotentHint: true } as const;

const DRAFT_FIELDS = {
  title: z.string().min(1).max(500).describe("Headline of the piece, 8-300 characters."),
  content: z.string().min(1).max(120_000).describe("Full text, 100-100000 characters. Plain text or light HTML. Publishing additionally requires at least 300 characters."),
  summary: z.string().max(2000).nullish().describe("One-sentence conclusion the reader sees first. Required at publish time — it becomes the report's analysis on the site."),
  sourceUrl: z.string().max(2000).nullish().describe("HTTPS link to where this was published. Required at publish time."),
  institutionSlug: z.string().max(120).nullish().describe("Tline institution slug the piece is attributed to; must already be registered. Required at publish time."),
  language: z.string().max(35).nullish().describe("BCP-47 tag of the content; defaults to en."),
  sourcePublishedAt: z.string().max(40).nullish().describe("ISO-8601 time the source was published."),
} as const;

const DRAFT_DTO_SCHEMA = {
  id: z.string(), title: z.string(), status: z.string(), version: z.number(), language: z.string(),
  summary: z.string().nullable(),
  sourceUrl: z.string().nullable(), institutionSlug: z.string().nullable(), sourcePublishedAt: z.string().nullable(),
  validationIssues: z.array(z.object({ code: z.string(), field: z.string(), message: z.string(), blocking: z.boolean() })),
  submittedAt: z.string().nullable(), publishedArticleId: z.string().nullable(), contentHash: z.string(),
  createdAt: z.string(), updatedAt: z.string(),
} as const;

const PUBLISH_RESULT_SCHEMA = {
  draft: z.object(DRAFT_DTO_SCHEMA),
  article: z.object({
    id: z.string(), slug: z.string(), pageUrl: z.string(),
    indexableEn: z.boolean(), indexableZh: z.boolean(),
    gateIssues: z.array(z.string()), documentReady: z.boolean(),
  }),
} as const;

/** One translation from a domain outcome to the MCP envelope, so the five tools agree. */
function settle<T>(outcome: DraftOutcome<T>) {
  if (!outcome.ok) return fail(outcome.code, outcome.message, outcome.details);
  return ok(outcome.data as unknown as Record<string, unknown>);
}

export function createPublisherServer(context: McpAuthContext, deps: PublisherToolDeps = defaultPublisherDeps, opsDeps: OpsToolDeps = defaultOpsDeps): McpServer {
  const server = new McpServer(
    { name: "tline-publisher-mcp", version: "1.2.0" },
    { instructions: "Drafting, publishing and operations access to Tline. Publishing a publication draft creates an institutional research report attributed to a registered publisher — it is not the newsroom and must not carry original news. Original newsroom items (article, brief or flash) belong in create_news / publish_news, which require admin:manage; recurring desks are listed by list_news_columns, created by create_news_column, and editions are filed with columnSlug. A news item may carry a sources array (display metadata; the same URL may appear every day — there is no source uniqueness key), and add_news_image stores a public HTTPS image with the item at a chosen paragraph. list_publisher_institutions gives the exact publisher slugs. Without extra scopes you can create, revise and submit drafts for review; with publisher:publish on your key you can publish a draft as a public report (judged by the same gate as every other report); with admin:manage on a reviewer or admin key you can run the site: withdraw/restore reports, set editorial picks, pause or resume sources, and write, edit, publish, unpublish, pin or delete newsroom items. Every action is audited and gated by the account's live permissions — the account's role is re-checked on every call. Always read validationIssues before submitting or publishing." },
  );
  const actor = { userId: context.actorId, keyId: context.key.id };

  server.registerTool("create_publication_draft", {
    title: "Create publication draft",
    description: "Create a private draft in Tline's review queue and validate it immediately. The response carries the draft id, its version and any validationIssues (blocking issues must be fixed before submission). Nothing is visible to readers — a draft only reaches the review queue when you submit it, and only reaches the site after a human approves it.",
    inputSchema: DRAFT_FIELDS,
    outputSchema: DRAFT_DTO_SCHEMA,
    annotations: WRITE,
  }, toolGuard("create_publication_draft", async (args) => settle(await deps.createDraft(args, actor))));

  server.registerTool("update_publication_draft", {
    title: "Update publication draft",
    description: "Replace a DRAFT's content and revalidate it. Requires the version you last read; a stale version is refused with VERSION_CONFLICT so concurrent edits cannot overwrite each other. On success the version increments — use the version in the response for the next call.",
    inputSchema: { id: z.string().describe("Draft id."), version: z.number().int().positive().describe("The version this update is based on."), ...DRAFT_FIELDS },
    outputSchema: DRAFT_DTO_SCHEMA,
    annotations: WRITE,
  }, toolGuard("update_publication_draft", async (args) => settle(await deps.updateDraft(args, actor))));

  server.registerTool("validate_publication_draft", {
    title: "Validate publication draft",
    description: "Re-run the validation rules against a DRAFT without changing it. Returns the draft with its current validationIssues; blocking issues prevent submission, warnings do not.",
    inputSchema: { id: z.string().describe("Draft id."), version: z.number().int().positive().describe("The version to validate.") },
    outputSchema: DRAFT_DTO_SCHEMA,
    annotations: IDEMPOTENT_WRITE,
  }, toolGuard("validate_publication_draft", async (args) => settle(await deps.validateDraft(args, actor))));

  server.registerTool("submit_publication_for_review", {
    title: "Submit draft for review",
    description: "Move a DRAFT with no blocking issues into the review queue (PENDING_REVIEW), where a human decides. Requires the current version; resubmitting a stale or already-submitted draft is refused, never duplicated.",
    inputSchema: { id: z.string().describe("Draft id."), version: z.number().int().positive().describe("The current version to submit.") },
    outputSchema: DRAFT_DTO_SCHEMA,
    annotations: IDEMPOTENT_WRITE,
  }, toolGuard("submit_publication_for_review", async (args) => settle(await deps.submitDraft(args, actor))));

  server.registerTool("publish_publication_draft", {
    title: "Publish draft",
    description: [
      "Publish a draft as an institutional research report on Tline. Requires a key carrying the publisher:publish scope. Use this only for research attributed to a registered publisher; original newsroom items belong in create_news / publish_news and must never become a research article.",
      "The whole publishable set must be present: sourceUrl, institutionSlug, at least 300 characters of content, and a summary (it becomes the report's analysis on the site).",
      "Pass the contentHash from the draft you read — the preview hash; publishing anything other than what was read is refused.",
      "The article is created and then judged by the same public gate as every other report: the reply carries the gate's verdict (indexableEn/indexableZh and any issues) so you can verify what actually went live. A draft that fails the gate is reported as withheld, not forced live.",
      "There is no unpublish over MCP: taking a report down is an operations action in the Tline console.",
    ].join(" "),
    inputSchema: {
      id: z.string().describe("Draft id."),
      version: z.number().int().positive().describe("The current version to publish."),
      expectedContentHash: z.string().length(64).describe("The contentHash returned with the draft; proves this call publishes exactly what was read."),
    },
    outputSchema: PUBLISH_RESULT_SCHEMA,
    annotations: { ...WRITE, idempotentHint: true },
  }, toolGuard("publish_publication_draft", async (args) => {
    if (!context.key.scopes.includes("publisher:publish")) {
      return fail("SCOPE_DENIED", "This key lacks the publisher:publish scope; it can draft and submit but not publish. Ask an operator to issue or extend a key with publisher:publish.");
    }
    return settle(await deps.publishDraft(args, actor));
  }));

  server.registerTool("list_publication_drafts", {
    title: "List publication drafts",
    description: "List the drafts created by this key's account, newest update first. Cross-account listing is a console feature and is not available over MCP.",
    inputSchema: {
      status: z.enum(["DRAFT", "PENDING_REVIEW", "PUBLISHED"]).optional().describe("Filter by state."),
      cursor: z.string().max(200).optional().describe("Opaque cursor from a previous call's nextCursor."),
      limit: z.number().int().min(1).max(50).optional().describe("Drafts per page, 1-50; default 20."),
    },
    outputSchema: { drafts: z.array(z.object(DRAFT_DTO_SCHEMA)), nextCursor: z.string().nullable() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, toolGuard("list_publication_drafts", async (args) => settle(await deps.listDrafts({ status: args.status, cursor: args.cursor, limit: args.limit ?? 20 }, actor))));

  // Site operations (admin:manage): report lifecycle, source monitoring, the newsroom.
  registerOpsTools(server, context, opsDeps);
  return server;
}
