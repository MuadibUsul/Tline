import "dotenv/config";
import { prisma } from "../src/lib/db";
import { loadFeishuSettings, sendDraftCard } from "../src/lib/social/feishu";

/**
 * One-shot manual test: send the newest research draft's review card to the
 * configured Feishu group, exactly as the notify step of the pipeline would.
 */
async function main() {
  const settings = await loadFeishuSettings();
  if (settings.source === "none") throw new Error("No Feishu configuration found (DB credential or FEISHU_* env).");
  console.log("feishu source:", settings.source, "receiveIdType:", settings.receiveIdType);

  const draft = await prisma.socialDraft.findFirst({
    where: { status: "PENDING_REVIEW", feishuMessageId: null },
    orderBy: { createdAt: "desc" },
    include: { deliveries: { include: { account: true } } },
  });
  if (!draft) throw new Error("No unnotified PENDING_REVIEW draft in the database.");

  const messageId = await sendDraftCard({
    id: draft.id,
    title: draft.title,
    textEn: draft.textEn,
    textZh: draft.textZh,
    routeSnapshot: draft.routeSnapshot,
    version: draft.version,
    status: draft.status,
    deliveries: draft.deliveries.map((delivery) => ({
      status: delivery.status,
      lastError: delivery.lastError,
      mainPostId: delivery.mainPostId,
      replyPostId: delivery.replyPostId,
      account: { label: delivery.account.label, externalUsername: delivery.account.externalUsername },
    })),
  });
  console.log(`sent card message ${messageId} for draft ${draft.id} (${draft.sourceKind}/${draft.sourceId}, v${draft.version})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
