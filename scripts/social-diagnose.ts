import "dotenv/config";
import { prisma } from "../src/lib/db";
import { feishuConfigStatus, loadFeishuSettings } from "../src/lib/social/feishu";

/**
 * Why a review card did or did not reach the group.
 *
 * The whole chain is in one place: whether Feishu is configured at all, which accounts and
 * routes a candidate needs before a draft can even be created, what the last drafts did,
 * and the audit trail of the decisions taken about them. Read-only, and it prints no
 * secrets — the settings are reported as configured or not, never as values.
 */
async function main() {
  const feishu = await loadFeishuSettings();
  const [accounts, routes, drafts, audits, releases] = await Promise.all([
    prisma.socialAccount.findMany({ select: { label: true, language: true, enabled: true, externalUsername: true, lastError: true } }),
    prisma.socialRoute.findMany({ select: { sourceKind: true, enabled: true, account: { select: { label: true, language: true, enabled: true } } } }),
    prisma.socialDraft.findMany({
      orderBy: { createdAt: "desc" }, take: 8,
      select: { id: true, title: true, sourceKind: true, status: true, approvalMode: true, feishuMessageId: true, notifyAttempts: true, notifyError: true, notifiedAt: true, createdAt: true },
    }),
    prisma.auditLog.findMany({ where: { action: { startsWith: "social." } }, orderBy: { createdAt: "desc" }, take: 8, select: { action: true, createdAt: true, metadata: true } }),
    prisma.macroRelease.findMany({
      where: { status: "RELEASED", releasedAt: { gte: new Date(Date.now() - 36 * 3600_000) } },
      orderBy: { releasedAt: "desc" },
      select: { id: true, titleEn: true, importance: true, releasedAt: true, analysisAt: true, values: { select: { actualInitial: true, previousAtRelease: true, consensusAtRelease: true } } },
    }),
  ]);
  console.log(JSON.stringify({
    feishu: {
      stage: feishuConfigStatus(feishu),
      source: feishu.source,
      receiveIdConfigured: Boolean(feishu.receiveId),
      receiveIdType: feishu.receiveIdType,
      approversConfigured: feishu.approverOpenIds.split(",").filter(Boolean).length,
    },
    accounts,
    routes,
    drafts,
    recentReleases: releases.map((release) => ({
      id: release.id, title: release.titleEn, importance: release.importance, releasedAt: release.releasedAt,
      analysisAt: release.analysisAt, values: release.values.length,
      seriesComplete: release.values.every((value) => value.actualInitial !== null && value.previousAtRelease !== null && value.consensusAtRelease !== null),
    })),
    audits,
  }, null, 2));
}

main().catch((error) => { console.error(String(error)); process.exitCode = 1; }).finally(() => prisma.$disconnect());
