import { PrismaClient } from "@prisma/client";

export async function startWorkerHeartbeat(name, details = () => ({})) {
  const prisma = new PrismaClient();
  const startedAt = new Date();
  const pulse = (status = "running") => prisma.workerHeartbeat.upsert({
    where: { name },
    create: { name, status, details: JSON.stringify(details()), startedAt },
    update: { status, details: JSON.stringify(details()), startedAt },
  });
  await pulse();
  const timer = setInterval(() => pulse().catch((error) => console.error(JSON.stringify({ event: "worker.heartbeat.failed", worker: name, error: String(error) }))), 30_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pulse("stopped").catch(() => undefined);
    await prisma.$disconnect();
  };
}
