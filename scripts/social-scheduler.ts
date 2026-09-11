import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runSocialCycle } from "../src/lib/social/pipeline";

const interval = Math.max(5_000, Number(process.env.SOCIAL_INTERVAL_MS || 5_000));
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

// An interrupted outbound request has an unknown result. Never replay it automatically:
// an operator must verify X before choosing Retry, which is safer than a duplicate post.
const interrupted = await prisma.socialDelivery.findMany({ where: { status: "PUBLISHING" }, select: { id: true, draftId: true } });
if (interrupted.length) {
  await prisma.socialDelivery.updateMany({ where: { id: { in: interrupted.map((item) => item.id) } }, data: { status: "FAILED", lastError: "Publisher restarted during delivery; verify X before retrying." } });
  for (const draftId of [...new Set(interrupted.map((item) => item.draftId))]) {
    const succeeded = await prisma.socialDelivery.count({ where: { draftId, status: "SUCCEEDED" } });
    await prisma.socialDraft.update({ where: { id: draftId }, data: { status: succeeded ? "PARTIAL" : "FAILED" } });
  }
}
await prisma.workerHeartbeat.upsert({ where: { name: "social" }, create: { name: "social" }, update: { status: "running", startedAt: new Date() } });

while (!stopping) {
  const started = Date.now();
  try {
    const metrics = await runSocialCycle();
    await prisma.workerHeartbeat.update({ where: { name: "social" }, data: { status: "running", details: JSON.stringify(metrics) } });
  } catch (error) {
    console.error(JSON.stringify({ event: "social.cycle.failed", error: String(error) }));
    await prisma.workerHeartbeat.update({ where: { name: "social" }, data: { status: "failed", details: JSON.stringify({ error: String(error).slice(0, 500) }) } }).catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(250, interval - (Date.now() - started))));
}
await prisma.workerHeartbeat.update({ where: { name: "social" }, data: { status: "stopped" } }).catch(() => {});
await prisma.$disconnect();
