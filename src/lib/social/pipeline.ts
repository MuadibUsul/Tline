import { prisma } from "../db";
import { siteUrl } from "../site";
import { writeAudit } from "../audit";
import { macroPosts, researchPosts, validatePost } from "./content";
import { sendDraftCard, updateDraftCard } from "./feishu";
import { createXPost } from "./x";
import { localePath } from "../i18n";
import { researchPath } from "../researchPath";
import { authorizedExpectationIds } from "../macro/expectationUse";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.SOCIAL_PUBLISH_ATTEMPTS || 6));

function text(value: { toString(): string } | null | undefined) { return value?.toString() ?? null; }
async function linkFor(kind: string, id: string, language: string) {
  const path = kind === "macro"
    ? `/macro/release/${id}`
    : researchPath(await prisma.article.findUniqueOrThrow({ where: { id }, select: { slug: true } }));
  return `${siteUrl()}${localePath(language === "zh-CN" ? "zh-CN" : "en", path)}`;
}
async function routeSnapshot(sourceKind: "research" | "macro") {
  const routes = await prisma.socialRoute.findMany({ where: { sourceKind, enabled: true, account: { enabled: true } }, include: { account: true } });
  return routes.map((route) => ({ accountId: route.accountId, label: route.account.label, language: route.account.language, username: route.account.externalUsername }));
}

async function createMacroCandidates() {
  const targets = await routeSnapshot("macro");
  if (!targets.length) return 0;
  const releases = await prisma.macroRelease.findMany({
    where: { status: "RELEASED", importance: 5, analysisAt: { gte: new Date(Date.now() - 24 * 3600_000) }, analysisEn: { not: null }, analysisZh: { not: null }, values: { some: { actualInitial: { not: null } } } },
    orderBy: { releasedAt: "desc" }, take: 20,
    include: { values: { where: { actualInitial: { not: null } }, include: { indicator: true, consensusExpectation: true }, orderBy: { createdAt: "asc" } } },
  });
  const existing = new Set((await prisma.socialDraft.findMany({
    where: { sourceKind: "macro", sourceId: { in: releases.map((release) => release.id) } },
    select: { sourceId: true },
  })).map((draft) => draft.sourceId));
  let created = 0;
  for (const release of releases) {
    if (existing.has(release.id)) continue;
    const authorized = await authorizedExpectationIds(release.values.flatMap((value) => value.consensusExpectation ? [value.consensusExpectation] : []), "social");
    let posts;
    try { posts = macroPosts({
        titleEn: release.titleEn, titleZh: release.titleZh,
        analysisEn: release.analysisEn!, analysisZh: release.analysisZh!,
        values: release.values.map((value) => ({ nameEn: value.indicator.nameEn, nameZh: value.indicator.nameZh, actual: text(value.actualInitial)!, consensus: value.consensusExpectation && authorized.has(value.consensusExpectation.id) ? text(value.consensusAtRelease) : null, previous: text(value.previousAtRelease) })),
      });
    } catch (error) { console.warn(JSON.stringify({ event: "social.macro.skipped", releaseId: release.id, reason: String(error) })); continue; }
    try {
      await prisma.socialDraft.create({ data: { sourceKind: "macro", sourceId: release.id, title: release.titleEn, textEn: posts.en, textZh: posts.zh, routeSnapshot: JSON.stringify(targets) } });
      created++;
    } catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; }
  }
  return created;
}

async function createResearchCandidates() {
  const targets = await routeSnapshot("research");
  if (!targets.length) return 0;
  // Every report that goes live with a reviewed Chinese summary is a review
  // candidate, so the Feishu card lands in the same scheduler tick that the
  // report appears on the site. The unique(sourceKind, sourceId) index dedupes;
  // the window only bounds how far back a missed backlog reaches, and the
  // per-cycle take spreads that backlog over a few ticks.
  const windowMs = Math.max(1, Number(process.env.SOCIAL_RESEARCH_REVIEW_HOURS || 48)) * 3600_000;
  const perCycle = Math.max(1, Number(process.env.SOCIAL_RESEARCH_REVIEW_PER_CYCLE || 25));
  const analyses = await prisma.analysis.findMany({
    where: { reviewStatus: "ok", summaryZh: { not: null }, article: { rawText: { not: null }, publishedAt: { gte: new Date(Date.now() - windowMs) } } },
    orderBy: { article: { publishedAt: "desc" } }, take: perCycle,
    include: { article: { include: { institution: true } } },
  });
  const existing = new Set((await prisma.socialDraft.findMany({
    where: { sourceKind: "research", sourceId: { in: analyses.map((analysis) => analysis.articleId) } },
    select: { sourceId: true },
  })).map((draft) => draft.sourceId));
  let created = 0;
  for (const analysis of analyses) {
    if (!analysis.summaryZh || existing.has(analysis.articleId)) continue;
    const posts = researchPosts({
      institution: analysis.article.institution.name,
      summaryEn: analysis.summary, summaryZh: analysis.summaryZh,
      interpretationEn: analysis.interpretation, interpretationZh: analysis.interpretationZh,
    });
    try {
      await prisma.socialDraft.create({ data: { sourceKind: "research", sourceId: analysis.articleId, title: analysis.article.title, textEn: posts.en, textZh: posts.zh, routeSnapshot: JSON.stringify(targets) } });
      created++;
    } catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; }
  }
  return created;
}

export async function createEligibleDrafts() {
  const [macro, research] = await Promise.all([createMacroCandidates(), createResearchCandidates()]);
  return { macro, research };
}

// Once a draft has failed this many times, record an audit event so a lasting
// Feishu outage surfaces instead of the card silently never being delivered.
const NOTIFY_ALERT_THRESHOLD = Math.max(1, Number(process.env.SOCIAL_NOTIFY_ALERT_ATTEMPTS || 5));

/** Exponential backoff (capped at 30 min) between notification attempts. */
function notifyReadyAt(draft: { notifyAttempts: number; updatedAt: Date }) {
  if (draft.notifyAttempts <= 0) return 0;
  return draft.updatedAt.getTime() + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(draft.notifyAttempts - 1, 5));
}

export async function notifyPendingDrafts(limit = 10, now = new Date()) {
  // No permanent attempt cap: a transient Feishu outage must not strand a review
  // card forever. Backoff between attempts keeps a persistently failing draft from
  // being retried every cycle, and an audit event is written once it looks stuck.
  const drafts = await prisma.socialDraft.findMany({ where: { status: "PENDING_REVIEW", feishuMessageId: null }, orderBy: { createdAt: "asc" }, take: limit * 5 });
  let sent = 0;
  for (const draft of drafts) {
    if (sent >= limit) break;
    if (notifyReadyAt(draft) > now.getTime()) continue;
    try {
      const messageId = await sendDraftCard(draft);
      await prisma.socialDraft.update({ where: { id: draft.id }, data: { feishuMessageId: messageId, notifiedAt: now, notifyAttempts: { increment: 1 }, notifyError: null } });
      sent++;
    } catch (error) {
      const attempts = draft.notifyAttempts + 1;
      const message = String(error).slice(0, 500);
      await prisma.socialDraft.update({ where: { id: draft.id }, data: { notifyAttempts: { increment: 1 }, notifyError: message } });
      // Fire exactly once, when the counter first crosses the threshold.
      if (attempts === NOTIFY_ALERT_THRESHOLD) {
        await writeAudit({ action: "social.notify.stuck", targetType: "socialDraft", targetId: draft.id, metadata: { attempts, error: message } });
      }
    }
  }
  return sent;
}

export async function decideDraft(id: string, version: number, decision: "approve" | "reject", actorId: string) {
  const draft = await prisma.socialDraft.findUnique({ where: { id } });
  if (!draft || draft.status !== "PENDING_REVIEW" || draft.version !== version) return { ok: false, message: "This draft version is no longer pending." };
  if (decision === "approve") {
    let snapshot: Array<{ accountId: string; language: string }> = [];
    try { const parsed = JSON.parse(draft.routeSnapshot); if (Array.isArray(parsed)) snapshot = parsed; } catch {}
    const accounts = await prisma.socialAccount.findMany({ where: { id: { in: snapshot.map((item) => item.accountId) }, enabled: true } });
    const routes = snapshot.flatMap((item) => accounts.some((account) => account.id === item.accountId) ? [item] : []);
    if (!routes.length) return { ok: false, message: "No reviewed publishing target is currently enabled." };
    const changed = await prisma.$transaction(async (tx) => {
      const changed = await tx.socialDraft.updateMany({ where: { id, version, status: "PENDING_REVIEW" }, data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() } });
      if (!changed.count) return false;
      await tx.socialDelivery.createMany({ data: routes.map((route) => ({ draftId: id, accountId: route.accountId, language: route.language })) });
      return true;
    });
    if (!changed) return { ok: false, message: "This draft was already decided." };
  } else {
    const changed = await prisma.socialDraft.updateMany({ where: { id, version, status: "PENDING_REVIEW" }, data: { status: "REJECTED", rejectedById: actorId, rejectedAt: new Date() } });
    if (!changed.count) return { ok: false, message: "This draft was already decided." };
  }
  await writeAudit({ actorId: actorId.startsWith("feishu:") ? null : actorId, action: `social.draft.${decision}`, targetType: "socialDraft", targetId: id, metadata: { version, actor: actorId } });
  return { ok: true, message: decision === "approve" ? "Approved and queued." : "Rejected." };
}

export async function refreshDraftCard(id: string) {
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { deliveries: { include: { account: true } } } });
  if (!draft?.feishuMessageId) return;
  await updateDraftCard(draft.feishuMessageId, draft).catch(() => {});
}

export async function regenerateDraft(id: string) {
  const draft = await prisma.socialDraft.findUnique({ where: { id } });
  if (!draft || draft.status !== "PENDING_REVIEW") return false;
  let posts: { en: string; zh: string } | null = null;
  if (draft.sourceKind === "research") {
    const analysis = await prisma.analysis.findUnique({ where: { articleId: draft.sourceId }, include: { article: { include: { institution: true } } } });
    if (analysis?.summaryZh) posts = researchPosts({ institution: analysis.article.institution.name, summaryEn: analysis.summary, summaryZh: analysis.summaryZh, interpretationEn: analysis.interpretation, interpretationZh: analysis.interpretationZh });
  } else if (draft.sourceKind === "macro") {
    const release = await prisma.macroRelease.findUnique({ where: { id: draft.sourceId }, include: { values: { where: { actualInitial: { not: null } }, include: { indicator: true, consensusExpectation: true }, orderBy: { createdAt: "asc" } } } });
    if (release?.analysisEn && release.analysisZh) {
      const authorized = await authorizedExpectationIds(release.values.flatMap((value) => value.consensusExpectation ? [value.consensusExpectation] : []), "social");
      try { posts = macroPosts({ titleEn: release.titleEn, titleZh: release.titleZh, analysisEn: release.analysisEn, analysisZh: release.analysisZh, values: release.values.map((value) => ({ nameEn: value.indicator.nameEn, nameZh: value.indicator.nameZh, actual: text(value.actualInitial)!, consensus: value.consensusExpectation && authorized.has(value.consensusExpectation.id) ? text(value.consensusAtRelease) : null, previous: text(value.previousAtRelease) })) }); } catch { return false; }
    }
  }
  if (!posts) return false;
  await prisma.socialDraft.update({ where: { id }, data: { textEn: posts.en, textZh: posts.zh, version: { increment: 1 } } });
  await refreshDraftCard(id);
  return true;
}

async function publishDelivery(id: string) {
  const claimed = await prisma.socialDelivery.updateMany({ where: { id, status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: new Date() } }, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
  if (!claimed.count) return;
  const delivery = await prisma.socialDelivery.findUnique({ where: { id }, include: { draft: true, account: true } });
  if (!delivery) return;
  try {
    const post = delivery.language === "zh-CN" ? delivery.draft.textZh : delivery.draft.textEn;
    const invalid = validatePost(post);
    if (invalid) throw new Error(invalid);
    const mainPostId = delivery.mainPostId || await createXPost(delivery.accountId, post);
    if (!delivery.mainPostId) await prisma.socialDelivery.update({ where: { id }, data: { mainPostId } });
    const replyPostId = delivery.replyPostId || await createXPost(delivery.accountId, await linkFor(delivery.draft.sourceKind, delivery.draft.sourceId, delivery.language), mainPostId);
    await prisma.socialDelivery.update({ where: { id }, data: { status: "SUCCEEDED", mainPostId, replyPostId, publishedAt: new Date(), lastError: null } });
    await writeAudit({ action: "social.delivery.succeeded", targetType: "socialDelivery", targetId: id, metadata: { accountId: delivery.accountId, mainPostId, replyPostId } });
  } catch (error) {
    const attempts = delivery.attempts;
    const uncertain = (error as { name?: string }).name === "UncertainPublishError";
    const message = String(error).slice(0, 500);
    await prisma.socialDelivery.update({ where: { id }, data: {
      status: uncertain || attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY",
      nextAttemptAt: new Date(Date.now() + Math.min(30 * 60_000, 10_000 * 2 ** Math.max(0, attempts - 1))),
      lastError: message,
    } });
    await writeAudit({ action: "social.delivery.failed", targetType: "socialDelivery", targetId: id, metadata: { accountId: delivery.accountId, attempts, uncertain, error: message } });
  }
  await updateDraftStatus(delivery.draftId);
}

async function updateDraftStatus(id: string) {
  const draft = await prisma.socialDraft.findUnique({ where: { id }, include: { deliveries: true } });
  if (!draft?.deliveries.length) return;
  const statuses = draft.deliveries.map((item) => item.status);
  const status = statuses.every((item) => item === "SUCCEEDED") ? "SUCCEEDED"
    : statuses.some((item) => ["PENDING", "RETRY", "PUBLISHING"].includes(item)) ? "PUBLISHING"
      : statuses.some((item) => item === "SUCCEEDED") ? "PARTIAL" : "FAILED";
  if (draft.status !== status) await prisma.socialDraft.update({ where: { id }, data: { status } });
  await refreshDraftCard(id);
}

export async function publishApproved(limit = 10) {
  const approved = await prisma.socialDraft.findMany({ where: { status: "APPROVED" }, select: { id: true } });
  if (approved.length) await prisma.socialDraft.updateMany({ where: { id: { in: approved.map((item) => item.id) } }, data: { status: "PUBLISHING" } });
  const deliveries = await prisma.socialDelivery.findMany({ where: { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: { id: true } });
  for (const delivery of deliveries) await publishDelivery(delivery.id);
  return deliveries.length;
}

export async function runSocialCycle() {
  const created = await createEligibleDrafts();
  const notified = await notifyPendingDrafts();
  const published = await publishApproved();
  return { ...created, notified, published };
}
