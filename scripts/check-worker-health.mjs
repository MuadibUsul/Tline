import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { sendOpsAlert } from "./ops-alert.mjs";

const name = process.argv[2];
if (!name) process.exit(2);

const STALE_MS = 120_000; // >2 minutes without a heartbeat
const ALERT_COOLDOWN_MS = 30 * 60_000; // do not re-alert the same worker more than once per half hour

const prisma = new PrismaClient();
try {
  const worker = await prisma.workerHeartbeat.findUnique({ where: { name } });
  const healthy = worker?.status === "running" && Date.now() - worker.lastSeenAt.getTime() < STALE_MS;

  if (healthy) {
    // Recovered: clear the alert latch so the next outage alerts again.
    if (worker?.alertedAt) {
      await prisma.workerHeartbeat.update({ where: { name }, data: { alertedAt: null } });
    }
    process.exitCode = 0;
  } else if (worker) {
    // Stale heartbeat: alert on the transition (and every cooldown window after).
    const lastAlert = worker.alertedAt?.getTime() || 0;
    if (Date.now() - lastAlert >= ALERT_COOLDOWN_MS) {
      await sendOpsAlert(
        `heartbeat stale：${name} 心跳超过 ${STALE_MS / 1000}s 未更新 @ ${new Date().toISOString()}`
      );
      await prisma.workerHeartbeat.update({ where: { name }, data: { alertedAt: new Date() } });
    }
    process.exitCode = 1;
  } else {
    // No row at all: the worker never registered, not a stale-heartbeat case.
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
