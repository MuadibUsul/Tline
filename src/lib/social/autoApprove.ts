import { prisma } from "../db";
import { writeAudit } from "../audit";
import { validatePost } from "./content";

/**
 * Publishing five-star releases without a human decision.
 *
 * A five-star print is the case where waiting costs the most: the number is public, the
 * analysis is written, and the post is a template filled from captured data. When the
 * operator has switched this on, such a draft publishes on its own — but only while every
 * input is actually sound, and the group is still told, because the point of the card is
 * to know what went out, not to be asked.
 *
 * The switch is off unless a row says otherwise. This posts to a public account.
 */
export const AUTO_APPROVE_SETTING = "social.auto_approve_importance_5";

/** Five-star releases only; everything below keeps its review step whatever the switch says. */
export const AUTO_APPROVE_IMPORTANCE = 5;

export async function autoApproveReleaseEnabled(): Promise<boolean> {
  const row = await prisma.socialSetting.findUnique({ where: { key: AUTO_APPROVE_SETTING }, select: { value: true } });
  return row?.value === "on";
}

export async function setAutoApproveRelease(enabled: boolean, actorId: string) {
  await prisma.socialSetting.upsert({
    where: { key: AUTO_APPROVE_SETTING },
    create: { key: AUTO_APPROVE_SETTING, value: enabled ? "on" : "off" },
    update: { value: enabled ? "on" : "off" },
  });
  await writeAudit({ actorId, action: "social.auto_approve.set", targetType: "socialSetting", targetId: AUTO_APPROVE_SETTING, metadata: { enabled } });
}

export interface AutoApprovalValue {
  actualInitial: { toString(): string } | null;
  previousAtRelease: { toString(): string } | null;
  consensusAtRelease: { toString(): string } | null;
}

export interface AutoApprovalInput {
  importance: number;
  values: AutoApprovalValue[];
  analysisEn: string | null;
  analysisZh: string | null;
  analysisAt: Date | null;
  textEn: string;
  textZh: string;
}

/**
 * Why this release must still be reviewed. Null means every gate passed.
 *
 * The value gate is deliberately about the two series the post will actually print — the
 * numbers a reader will see, not every indicator the release carries. A release whose
 * first two series have a previous value and a consensus is a post whose every number can
 * be read against the market; a third series without them is not something the post
 * hides, and holding on it would mean the switch never fires on the releases it is for.
 */
export function autoApprovalRefusal(input: AutoApprovalInput): string | null {
  if (input.importance !== AUTO_APPROVE_IMPORTANCE) return `importance ${input.importance} is not a five-star release`;
  if (!input.analysisAt || !input.analysisEn?.trim() || !input.analysisZh?.trim()) return "no bilingual read-out";
  const printed = input.values.filter((value) => value.actualInitial !== null).slice(0, 2);
  if (!printed.length) return "no captured value";
  if (printed.some((value) => value.previousAtRelease === null)) return "a printed series has no previous value";
  if (printed.some((value) => value.consensusAtRelease === null)) return "a printed series has no survey consensus";
  const invalid = validatePost(input.textEn) ?? validatePost(input.textZh);
  if (invalid) return invalid;
  return null;
}

export interface AutoApprovalRun {
  enabled: boolean;
  approved: string[];
  held: Array<{ id: string; reason: string }>;
}

/**
 * Approve the drafts that qualify, oldest first.
 *
 * The approval itself reuses the same transition a human decision makes — status, the
 * account snapshot and the delivery rows — so an automatic approval cannot take a path
 * the reviewed one does not. What differs is only who is recorded as having decided.
 */
export async function autoApproveDrafts(limit = 5): Promise<AutoApprovalRun> {
  if (!await autoApproveReleaseEnabled()) return { enabled: false, approved: [], held: [] };
  const drafts = await prisma.socialDraft.findMany({
    where: { status: "PENDING_REVIEW", sourceKind: "macro" },
    orderBy: { createdAt: "asc" },
    take: limit * 3,
  });
  const run: AutoApprovalRun = { enabled: true, approved: [], held: [] };
  for (const draft of drafts) {
    if (run.approved.length >= limit) break;
    const release = await prisma.macroRelease.findUnique({
      where: { id: draft.sourceId },
      include: { values: { where: { actualInitial: { not: null } }, orderBy: { createdAt: "asc" } } },
    });
    if (!release) continue;
    const refusal = autoApprovalRefusal({
      importance: release.importance,
      values: release.values,
      analysisEn: release.analysisEn,
      analysisZh: release.analysisZh,
      analysisAt: release.analysisAt,
      textEn: draft.textEn,
      textZh: draft.textZh,
    });
    if (refusal) {
      run.held.push({ id: draft.id, reason: refusal });
      continue;
    }
    const { approveDraft } = await import("./pipeline");
    const result = await approveDraft(draft.id, draft.version, null, "auto");
    if (result.ok) {
      run.approved.push(draft.id);
      console.log(JSON.stringify({ event: "social.auto_approve.published", draftId: draft.id, releaseId: release.id, importance: release.importance }));
    } else {
      run.held.push({ id: draft.id, reason: result.message });
    }
  }
  return run;
}
