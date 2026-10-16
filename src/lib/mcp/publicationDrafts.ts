import { createHash } from "node:crypto";
import { prisma } from "../db";
import { writeAudit } from "../audit";
import { urlHash, titleHash, contentHash } from "../hash";
import { partitionArticleSegments } from "../articleText";
import { buildResearchSlug } from "../researchPath";
import { refreshClassification } from "../ingest/store";
import { generateArticleDocuments } from "../documents/pdf";
import { refreshGate } from "../gate";
import { siteUrl } from "../site";
import { localePath } from "../i18n";

/**
 * The publication-draft domain service behind the Publisher MCP.
 *
 * The state machine the spec fixes, and nothing beyond it:
 *
 *   DRAFT ──update/validate──> DRAFT ──submit──> PENDING_REVIEW ──> (operations console)
 *
 * There is no MCP transition out of PENDING_REVIEW: publishing, rejecting and deleting
 * remain console-only actions. Every mutation is guarded by the optimistic `version`
 * column, so a retried call cannot overwrite a newer edit or submit twice — the guard is
 * the `updateMany` WHERE clause, resolved by the database, not by a read-then-write in
 * application code.
 *
 * The validators are pure functions over the input so their rules can be tested without a
 * database; the service functions in this file are thin orchestration over them.
 */

const TITLE_MIN = 8;
const TITLE_MAX = 300;
const CONTENT_MIN = 100;
const CONTENT_MAX = 100_000;
/** Publishing needs the body the public gate itself demands (`thin_content` withholds <300). */
const PUBLISH_MIN_CONTENT = 300;
/** A publication date this far ahead of now is a data-entry mistake, not a schedule. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface DraftInput {
  title: string;
  content: string;
  /** The one-sentence conclusion publish stores as the article's Analysis. */
  summary?: string | null;
  sourceUrl?: string | null;
  institutionSlug?: string | null;
  language?: string | null;
  /** A string from tool arguments, a Date when revalidating a stored row. */
  sourcePublishedAt?: string | Date | null;
}

export interface DraftIssue {
  code: string;
  field: string;
  message: string;
  /** Blocking issues refuse submission; warnings are shown but do not. */
  blocking: boolean;
}

export interface DraftDto {
  id: string;
  title: string;
  status: string;
  version: number;
  language: string;
  summary: string | null;
  sourceUrl: string | null;
  institutionSlug: string | null;
  sourcePublishedAt: string | null;
  validationIssues: DraftIssue[];
  submittedAt: string | null;
  publishedArticleId: string | null;
  /** The preview hash publish requires back, so it can only publish what was read. */
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export type DraftOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION_FAILED" | "VERSION_CONFLICT"; message: string; details?: Record<string, unknown> };

/** The account and key every write is attributed to; the key id never enters the draft row. */
export interface DraftActor {
  userId: string;
  keyId: string;
}

/**
 * Field rules over one draft input. `knownInstitutionSlugs` is injected so the check
 * "the slug maps to an institution we know" is a fact of the caller's world, not a query
 * buried in the rule.
 */
export function validateDraftInput(input: DraftInput, knownInstitutionSlugs: ReadonlySet<string> = new Set()): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const title = input.title?.trim() ?? "";
  const content = input.content ?? "";

  if (title.length < TITLE_MIN) issues.push({ code: "title.too_short", field: "title", message: `Title must be at least ${TITLE_MIN} characters.`, blocking: true });
  if (title.length > TITLE_MAX) issues.push({ code: "title.too_long", field: "title", message: `Title must be at most ${TITLE_MAX} characters.`, blocking: true });

  if (!content.trim()) issues.push({ code: "content.empty", field: "content", message: "Content must not be blank.", blocking: true });
  else if (content.trim().length < CONTENT_MIN) issues.push({ code: "content.too_short", field: "content", message: `Content must be at least ${CONTENT_MIN} characters.`, blocking: true });
  else if (content.length > CONTENT_MAX) issues.push({ code: "content.too_long", field: "content", message: `Content must be at most ${CONTENT_MAX} characters.`, blocking: true });

  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 30 && new Set(lines).size < lines.length * 0.5) {
    issues.push({ code: "content.repetitive", field: "content", message: "More than half of the lines repeat — check for pasted duplicates.", blocking: false });
  }

  if (input.sourceUrl) {
    try {
      const url = new URL(input.sourceUrl);
      if (url.protocol !== "https:") issues.push({ code: "sourceUrl.not_https", field: "sourceUrl", message: "Source URL must use https.", blocking: true });
    } catch {
      issues.push({ code: "sourceUrl.invalid", field: "sourceUrl", message: "Source URL is not a valid URL.", blocking: true });
    }
  }

  if (input.language) {
    try {
      // Intl.Locale is the platform's BCP-47 parser: it accepts what the spec means by the
      // field and rejects the free text a caller might paste instead.
      new Intl.Locale(input.language);
    } catch {
      issues.push({ code: "language.invalid", field: "language", message: "Language must be a BCP-47 tag such as 'en' or 'zh-CN'.", blocking: true });
    }
  }

  if (input.sourcePublishedAt) {
    const parsed = new Date(input.sourcePublishedAt);
    if (isNaN(parsed.getTime())) {
      issues.push({ code: "sourcePublishedAt.invalid", field: "sourcePublishedAt", message: "Source publication date must be ISO-8601.", blocking: true });
    } else if (parsed.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      issues.push({ code: "sourcePublishedAt.future", field: "sourcePublishedAt", message: "Source publication date is in the future.", blocking: true });
    }
  }

  if (input.institutionSlug && !knownInstitutionSlugs.has(input.institutionSlug)) {
    issues.push({ code: "institution.unknown", field: "institutionSlug", message: `No institution is registered under '${input.institutionSlug}'.`, blocking: true });
  }

  if (input.summary && input.summary.trim().length > 0 && input.summary.trim().length < 40) {
    issues.push({ code: "summary.short", field: "summary", message: "A summary under 40 characters rarely says enough to stand as the report's conclusion.", blocking: false });
  }

  return issues;
}

/**
 * What publishing requires beyond the field rules — each maps to a rule the public gate
 * itself enforces, so a draft that would be withheld is refused here with a readable
 * reason instead of being published into invisibility.
 */
export function publishBlockers(input: DraftInput): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if ((input.content ?? "").trim().length < PUBLISH_MIN_CONTENT) {
    issues.push({ code: "content.too_short_to_publish", field: "content", message: `Publishing requires at least ${PUBLISH_MIN_CONTENT} characters of body text.`, blocking: true });
  }
  if (!input.sourceUrl?.trim()) {
    issues.push({ code: "sourceUrl.required", field: "sourceUrl", message: "Publishing requires the source URL — every public report links to where it came from.", blocking: true });
  }
  if (!input.institutionSlug?.trim()) {
    issues.push({ code: "institution.required", field: "institutionSlug", message: "Publishing requires the publishing institution.", blocking: true });
  }
  if (!input.summary?.trim()) {
    issues.push({ code: "summary.required", field: "summary", message: "Publishing requires a summary — it becomes the report's conclusion on the site.", blocking: true });
  }
  return issues;
}

export function blockingIssues(issues: DraftIssue[]): DraftIssue[] {
  return issues.filter((issue) => issue.blocking);
}

function parseIssues(value: string): DraftIssue[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as DraftIssue[]) : [];
  } catch {
    return [];
  }
}

type DraftRow = {
  id: string; title: string; status: string; version: number; language: string; summary: string | null;
  sourceUrl: string | null; institutionSlug: string | null; sourcePublishedAt: Date | null;
  validationIssues: string; submittedAt: Date | null; publishedArticleId: string | null;
  contentHash: string; createdAt: Date; updatedAt: Date;
};

function toDto(row: DraftRow): DraftDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    version: row.version,
    language: row.language,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    institutionSlug: row.institutionSlug,
    sourcePublishedAt: row.sourcePublishedAt?.toISOString() ?? null,
    validationIssues: parseIssues(row.validationIssues),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    publishedArticleId: row.publishedArticleId,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DTO_SELECT = {
  id: true, title: true, status: true, version: true, language: true, summary: true,
  sourceUrl: true, institutionSlug: true, sourcePublishedAt: true,
  validationIssues: true, submittedAt: true, publishedArticleId: true, contentHash: true, createdAt: true, updatedAt: true,
} as const;

/** Revalidation, submission and publishing need the body; every response shape deliberately omits it. */
const CONTENT_SELECT = { ...DTO_SELECT, content: true } as const;

/**
 * The preview hash: a digest over every field publish copies into the article.
 *
 * Publish requires it back (`expectedContentHash`), which is the spec's "preview hash"
 * rule — a caller can only publish a version of the draft it actually read, and an agent
 * that constructs the call from memory fails loudly instead of publishing drifted text.
 * Normalisation mirrors `normalizedFields` exactly, so a stored row and a fresh input
 * with the same content hash identically.
 */
export function draftContentHash(input: {
  title: string | null | undefined; content?: string; summary?: string | null;
  sourceUrl?: string | null; institutionSlug?: string | null; language?: string | null;
  sourcePublishedAt?: string | Date | null;
}): string {
  let publishedAt: string | null = null;
  if (input.sourcePublishedAt) {
    const parsed = new Date(input.sourcePublishedAt);
    publishedAt = isNaN(parsed.getTime()) ? String(input.sourcePublishedAt) : parsed.toISOString();
  }
  const canonical = JSON.stringify({
    title: (input.title ?? "").trim(),
    content: input.content ?? "",
    summary: (input.summary ?? "").trim() || null,
    sourceUrl: (input.sourceUrl ?? "").trim() || null,
    institutionSlug: (input.institutionSlug ?? "").trim() || null,
    language: (input.language ?? "").trim() || "en",
    sourcePublishedAt: publishedAt,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function knownInstitutionSlugs(slug: string | null | undefined): Promise<Set<string>> {
  if (!slug) return new Set();
  const rows = await prisma.institution.findMany({ where: { slug }, select: { slug: true } });
  return new Set(rows.map((row) => row.slug));
}

/** The fields the draft row stores, normalised once so create, update and hashing agree. */
function normalizedFields(input: DraftInput) {
  return {
    title: input.title.trim(),
    content: input.content,
    summary: input.summary?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    institutionSlug: input.institutionSlug?.trim() || null,
    language: input.language?.trim() || "en",
    sourcePublishedAt: input.sourcePublishedAt ? new Date(input.sourcePublishedAt) : null,
  };
}

function auditCodes(issues: DraftIssue[]) {
  return issues.map((issue) => issue.code);
}

export async function createDraft(input: DraftInput, actor: DraftActor): Promise<DraftOutcome<DraftDto>> {
  const issues = validateDraftInput(input, await knownInstitutionSlugs(input.institutionSlug));
  const fields = normalizedFields(input);
  const row = await prisma.mcpPublicationDraft.create({
    data: { ...fields, contentHash: draftContentHash(fields), validationIssues: JSON.stringify(issues), createdById: actor.userId },
    select: DTO_SELECT,
  });
  // The audit entry carries identifiers and outcome codes, never the draft text.
  await writeAudit({ actorId: actor.userId, action: "mcp.draft.create", targetType: "mcpPublicationDraft", targetId: row.id, metadata: { keyId: actor.keyId, version: row.version, issues: auditCodes(issues) } });
  return { ok: true, data: toDto(row) };
}

/** The own-draft lookup every mutation starts from; another account's draft is NOT_FOUND. */
async function findOwnDraft(id: string, actor: DraftActor) {
  return prisma.mcpPublicationDraft.findFirst({ where: { id, createdById: actor.userId }, select: DTO_SELECT });
}

type DraftRowWithContent = DraftRow & { content: string };

function guardStateAndVersion(row: DraftRow | null, version: number): { ok: false; code: "NOT_FOUND" | "VALIDATION_FAILED" | "VERSION_CONFLICT"; message: string; details?: Record<string, unknown> } | null {
  if (!row) return { ok: false, code: "NOT_FOUND", message: "No draft with that id belongs to this key's account." };
  if (row.status !== "DRAFT") return { ok: false, code: "VALIDATION_FAILED", message: `A ${row.status} draft is read-only over MCP.`, details: { status: row.status } };
  if (row.version !== version) return { ok: false, code: "VERSION_CONFLICT", message: "The draft has moved on since this version was read.", details: { currentVersion: row.version } };
  return null;
}

export async function updateDraft(input: DraftInput & { id: string; version: number }, actor: DraftActor): Promise<DraftOutcome<DraftDto>> {
  const existing = await findOwnDraft(input.id, actor);
  const refusal = guardStateAndVersion(existing, input.version);
  if (refusal) return refusal;

  const issues = validateDraftInput(input, await knownInstitutionSlugs(input.institutionSlug));
  const fields = normalizedFields(input);
  const changed = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: "DRAFT" },
    data: { ...fields, contentHash: draftContentHash(fields), validationIssues: JSON.stringify(issues), version: { increment: 1 } },
  });
  if (!changed.count) return { ok: false, code: "VERSION_CONFLICT", message: "The draft changed while this update was in flight; re-read it and retry." };

  const row = await findOwnDraft(input.id, actor);
  await writeAudit({ actorId: actor.userId, action: "mcp.draft.update", targetType: "mcpPublicationDraft", targetId: input.id, metadata: { keyId: actor.keyId, fromVersion: input.version, toVersion: input.version + 1, issues: auditCodes(issues) } });
  return { ok: true, data: toDto(row as DraftRow) };
}

export async function validateDraft(input: { id: string; version: number }, actor: DraftActor): Promise<DraftOutcome<DraftDto>> {
  const existing = await prisma.mcpPublicationDraft.findFirst({ where: { id: input.id, createdById: actor.userId }, select: CONTENT_SELECT });
  const refusal = guardStateAndVersion(existing, input.version);
  if (refusal) return refusal;

  const issues = validateDraftInput(existing as DraftRowWithContent, await knownInstitutionSlugs(existing?.institutionSlug));
  // Validation does not move the version: it changes only the stored findings.
  const changed = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: "DRAFT" },
    data: { validationIssues: JSON.stringify(issues) },
  });
  if (!changed.count) return { ok: false, code: "VERSION_CONFLICT", message: "The draft changed while validation was in flight; re-read it and retry." };

  const row = await findOwnDraft(input.id, actor);
  await writeAudit({ actorId: actor.userId, action: "mcp.draft.validate", targetType: "mcpPublicationDraft", targetId: input.id, metadata: { keyId: actor.keyId, version: input.version, issues: auditCodes(issues) } });
  return { ok: true, data: toDto(row as DraftRow) };
}

export async function submitDraft(input: { id: string; version: number }, actor: DraftActor): Promise<DraftOutcome<DraftDto>> {
  const existing = await prisma.mcpPublicationDraft.findFirst({ where: { id: input.id, createdById: actor.userId }, select: CONTENT_SELECT });
  const refusal = guardStateAndVersion(existing, input.version);
  if (refusal) return refusal;

  // Submission revalidates against the content as it stands now — the stored findings
  // could predate a change in the world (an institution unregistered, say), and the rule
  // is that a draft with blocking findings cannot be submitted.
  const issues = validateDraftInput(existing as DraftRowWithContent, await knownInstitutionSlugs(existing?.institutionSlug));
  const blocking = blockingIssues(issues);
  if (blocking.length) {
    return { ok: false, code: "VALIDATION_FAILED", message: "This draft has blocking validation issues and cannot be submitted.", details: { issues: blocking } };
  }

  const submittedAt = new Date();
  const changed = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: "DRAFT" },
    data: { status: "PENDING_REVIEW", submittedAt, validationIssues: JSON.stringify(issues), version: { increment: 1 } },
  });
  if (!changed.count) return { ok: false, code: "VERSION_CONFLICT", message: "The draft changed while submission was in flight; re-read it and retry." };

  const row = await findOwnDraft(input.id, actor);
  await writeAudit({ actorId: actor.userId, action: "mcp.draft.submit", targetType: "mcpPublicationDraft", targetId: input.id, metadata: { keyId: actor.keyId, fromVersion: input.version, toVersion: input.version + 1, issues: auditCodes(issues) } });
  return { ok: true, data: toDto(row as DraftRow) };
}

export interface PublishResult {
  draft: DraftDto;
  /** What the publish actually produced, with the gate's verdict so the caller can verify. */
  article: {
    id: string;
    slug: string;
    pageUrl: string;
    indexableEn: boolean;
    indexableZh: boolean;
    gateIssues: string[];
    documentReady: boolean;
  };
}

/**
 * Direct publishing (owner decision 2026-10-16): the draft becomes a public report.
 *
 * What keeps this controlled rather than reckless:
 *  - the caller must hold `publisher:publish` (checked in the tool layer) on top of the
 *    per-call role re-check every publisher key gets;
 *  - the draft must carry the full publishable set — source URL, institution, ≥300-char
 *    body and the agent-written summary — and pass every field rule;
 *  - `expectedContentHash` must match what was actually read (the preview hash);
 *  - the article is created through the same derive-and-store path the crawler uses and
 *    is then judged by the same public gate: a draft that survives all of the above but
 *    fails the gate is reported as withheld, not forced live;
 *  - the URL hash and body hash are globally unique, so no replayed or retried call can
 *    produce a second copy;
 *  - everything is audited, and withdrawal remains the console/ops path (`withdraw`).
 *
 * An article that fails mid-publish (crash after the row is created, before the document
 * exists) is invisible — the gate withholds it — and the next publish call resumes on its
 * own row instead of refusing forever.
 */
export async function publishDraft(input: { id: string; version: number; expectedContentHash: string }, actor: DraftActor): Promise<DraftOutcome<PublishResult>> {
  const row = await prisma.mcpPublicationDraft.findFirst({ where: { id: input.id, createdById: actor.userId }, select: CONTENT_SELECT });
  if (!row) return { ok: false, code: "NOT_FOUND", message: "No draft with that id belongs to this key's account." };
  if (row.status === "PUBLISHED") {
    return { ok: false, code: "VALIDATION_FAILED", message: "This draft has already been published.", details: { articleId: row.publishedArticleId ?? undefined } };
  }
  if (row.version !== input.version) return { ok: false, code: "VERSION_CONFLICT", message: "The draft has moved on since this version was read.", details: { currentVersion: row.version } };
  // The stored hash was written by the same two writers that touch content, so it is the
  // draft as it stands. The recompute is only for a row from before the column existed.
  const expected = row.contentHash || draftContentHash(row);
  if (input.expectedContentHash !== expected) {
    return { ok: false, code: "VALIDATION_FAILED", message: "The preview hash does not match the draft's current content; re-read the draft and confirm again.", details: { currentContentHash: expected } };
  }

  const issues = [...validateDraftInput(row, await knownInstitutionSlugs(row.institutionSlug)), ...publishBlockers(row)];
  const blockers = blockingIssues(issues);
  if (blockers.length) {
    return { ok: false, code: "VALIDATION_FAILED", message: "This draft has blocking issues and cannot be published.", details: { issues: blockers } };
  }

  const institution = await prisma.institution.findUnique({ where: { slug: row.institutionSlug! }, select: { id: true, name: true } });
  if (!institution) {
    return { ok: false, code: "VALIDATION_FAILED", message: "The institution on this draft is not registered.", details: { issues: [{ code: "institution.unknown", field: "institutionSlug", message: "Unknown institution.", blocking: true }] } };
  }

  // Claim the draft for the duration of the work: the version guard means we are acting on
  // exactly the content that was validated, and a PUBLISHING draft refuses update/submit
  // until this finishes. A status left at PUBLISHING by a crash is claimable again (the
  // version is unchanged), which is how a retry resumes its own half-made article.
  const claimed = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: { in: ["DRAFT", "PENDING_REVIEW", "PUBLISHING"] } },
    data: { status: "PUBLISHING" },
  });
  if (!claimed.count) {
    const current = await findOwnDraft(input.id, actor);
    return { ok: false, code: "VERSION_CONFLICT", message: "The draft changed while publishing started; re-read it and retry.", details: { currentVersion: current?.version ?? null, status: current?.status ?? null } };
  }

  const sourceUrl = row.sourceUrl!.trim();
  const uHash = urlHash(sourceUrl);
  const tHash = titleHash(row.title);
  const partitioned = partitionArticleSegments([{ heading: null, text: row.content }]);
  const text = partitioned.body.map((segment) => segment.text).join("\n\n").trim();
  const cHash = contentHash(text);

  let articleId: string;
  let slug: string;
  const sameUrl = await prisma.article.findUnique({
    where: { urlHash: uHash },
    select: { id: true, slug: true, contentHash: true, documents: { where: { kind: { in: ["source_native", "original_pdf"] }, locale: "en", status: "ready" }, select: { id: true }, take: 1 } },
  });
  if (sameUrl) {
    const resumable = sameUrl.contentHash === cHash && sameUrl.documents.length === 0;
    if (!resumable) {
      return { ok: false, code: "VALIDATION_FAILED", message: "A report from this source URL already exists.", details: { articleId: sameUrl.id, slug: sameUrl.slug } };
    }
    articleId = sameUrl.id;
    slug = sameUrl.slug;
  } else {
    const sameBody = await prisma.article.findFirst({ where: { contentHash: cHash }, select: { id: true, slug: true } });
    if (sameBody) {
      return { ok: false, code: "VALIDATION_FAILED", message: "This body text already exists as another report.", details: { articleId: sameBody.id, slug: sameBody.slug } };
    }
    try {
      const created = await prisma.article.create({
        data: {
          slug: buildResearchSlug({ institution: institution.name, title: row.title, fingerprint: uHash }),
          institutionId: institution.id,
          title: row.title,
          publishedAt: row.sourcePublishedAt ?? new Date(),
          sourceUrl,
          language: row.language,
          urlHash: uHash,
          titleHash: tHash,
          contentHash: cHash,
          rawText: text,
          segments: { create: partitioned.body.map((segment, position) => ({ position, heading: segment.heading, text: segment.text })) },
        },
        select: { id: true, slug: true },
      });
      articleId = created.id;
      slug = created.slug;
    } catch (error) {
      // urlHash is unique: a concurrent publish of the same draft lost the race here.
      if ((error as { code?: string }).code === "P2002") {
        return { ok: false, code: "VERSION_CONFLICT", message: "Another publish of this draft won the race; re-read it.", details: { contentHash: cHash } };
      }
      throw error;
    }
  }

  // The agent-written summary becomes the article's Analysis. This is the only no-LLM way
  // for a published article to pass the gate: `empty_summary` withholds a page without one.
  await prisma.analysis.upsert({
    where: { articleId },
    create: { articleId, summary: row.summary!.trim(), provider: "mcp", model: "publisher-agent", reviewStatus: "ok" },
    update: {},
  });
  await refreshClassification(articleId, cHash, tHash, row.title, text);

  let documentReady = false;
  try {
    await generateArticleDocuments(articleId);
    documentReady = true;
  } catch (error) {
    // The article stays invisible without the document (the gate requires one); the
    // scheduled `documents` pass repairs the row. Publish still reports truthfully.
    console.error(JSON.stringify({ event: "mcp.publish.documents.failed", articleId, error: String(error).slice(0, 300) }));
  }
  const verdict = await refreshGate(articleId);

  const finalized = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: "PUBLISHING" },
    data: { status: "PUBLISHED", publishedArticleId: articleId, version: { increment: 1 } },
  });
  if (!finalized.count) {
    return { ok: false, code: "VERSION_CONFLICT", message: "The draft moved while publishing finished; the article was created from the version you confirmed.", details: { articleId } };
  }

  await writeAudit({
    actorId: actor.userId,
    action: "mcp.draft.publish",
    targetType: "mcpPublicationDraft",
    targetId: input.id,
    metadata: {
      keyId: actor.keyId,
      fromVersion: input.version,
      toVersion: input.version + 1,
      articleId,
      documentReady,
      indexableEn: verdict?.indexable.en ?? false,
      indexableZh: verdict?.indexable["zh-CN"] ?? false,
    },
  });

  const refreshed = await findOwnDraft(input.id, actor);
  return {
    ok: true,
    data: {
      draft: toDto(refreshed as DraftRow),
      article: {
        id: articleId,
        slug,
        pageUrl: `${siteUrl()}${localePath("en", `/research/${slug}`)}`,
        indexableEn: verdict?.indexable.en ?? false,
        indexableZh: verdict?.indexable["zh-CN"] ?? false,
        gateIssues: verdict?.issues.en ?? [],
        documentReady,
      },
    },
  };
}

export async function listDrafts(options: { status?: string; cursor?: string; limit: number }, actor: DraftActor): Promise<DraftOutcome<{ drafts: DraftDto[]; nextCursor: string | null }>> {
  if (options.status && !["DRAFT", "PENDING_REVIEW", "PUBLISHED"].includes(options.status)) {
    return { ok: false, code: "VALIDATION_FAILED", message: "status must be DRAFT, PENDING_REVIEW or PUBLISHED." };
  }
  if (options.cursor && !(await prisma.mcpPublicationDraft.findFirst({ where: { id: options.cursor, createdById: actor.userId }, select: { id: true } }))) {
    return { ok: false, code: "VALIDATION_FAILED", message: "'cursor' does not match a draft on this account." };
  }
  const rows = await prisma.mcpPublicationDraft.findMany({
    // Reviewer sees only their own drafts; cross-account reading is a console feature.
    where: { createdById: actor.userId, ...(options.status ? { status: options.status } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: DTO_SELECT,
  });
  const page = rows.slice(0, options.limit);
  return { ok: true, data: { drafts: page.map(toDto), nextCursor: rows.length > options.limit ? page[page.length - 1]?.id ?? null : null } };
}
