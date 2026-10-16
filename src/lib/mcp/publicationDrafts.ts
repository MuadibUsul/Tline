import { prisma } from "../db";
import { writeAudit } from "../audit";

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
/** A publication date this far ahead of now is a data-entry mistake, not a schedule. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface DraftInput {
  title: string;
  content: string;
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
  sourceUrl: string | null;
  institutionSlug: string | null;
  sourcePublishedAt: string | null;
  validationIssues: DraftIssue[];
  submittedAt: string | null;
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
  id: string; title: string; status: string; version: number; language: string;
  sourceUrl: string | null; institutionSlug: string | null; sourcePublishedAt: Date | null;
  validationIssues: string; submittedAt: Date | null; createdAt: Date; updatedAt: Date;
};

function toDto(row: DraftRow): DraftDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    version: row.version,
    language: row.language,
    sourceUrl: row.sourceUrl,
    institutionSlug: row.institutionSlug,
    sourcePublishedAt: row.sourcePublishedAt?.toISOString() ?? null,
    validationIssues: parseIssues(row.validationIssues),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DTO_SELECT = {
  id: true, title: true, status: true, version: true, language: true,
  sourceUrl: true, institutionSlug: true, sourcePublishedAt: true,
  validationIssues: true, submittedAt: true, createdAt: true, updatedAt: true,
} as const;

/** Revalidation and submission need the body; every response shape deliberately omits it. */
const CONTENT_SELECT = { ...DTO_SELECT, content: true } as const;

async function knownInstitutionSlugs(slug: string | null | undefined): Promise<Set<string>> {
  if (!slug) return new Set();
  const rows = await prisma.institution.findMany({ where: { slug }, select: { slug: true } });
  return new Set(rows.map((row) => row.slug));
}

/** The fields the draft row stores, normalised once so create and update agree. */
function normalizedFields(input: DraftInput) {
  return {
    title: input.title.trim(),
    content: input.content,
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
  const row = await prisma.mcpPublicationDraft.create({
    data: { ...normalizedFields(input), validationIssues: JSON.stringify(issues), createdById: actor.userId },
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
  const changed = await prisma.mcpPublicationDraft.updateMany({
    where: { id: input.id, createdById: actor.userId, version: input.version, status: "DRAFT" },
    data: { ...normalizedFields(input), validationIssues: JSON.stringify(issues), version: { increment: 1 } },
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

export async function listDrafts(options: { status?: string; cursor?: string; limit: number }, actor: DraftActor): Promise<DraftOutcome<{ drafts: DraftDto[]; nextCursor: string | null }>> {
  if (options.status && !["DRAFT", "PENDING_REVIEW"].includes(options.status)) {
    return { ok: false, code: "VALIDATION_FAILED", message: "status must be DRAFT or PENDING_REVIEW." };
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
