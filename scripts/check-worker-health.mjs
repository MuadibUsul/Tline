import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const name = process.argv[2];
if (!name) process.exit(2);
const prisma = new PrismaClient();
try {
  const worker = await prisma.workerHeartbeat.findUnique({ where: { name } });
  const healthy = worker?.status === "running" && Date.now() - worker.lastSeenAt.getTime() < 120_000;
  process.exitCode = healthy ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
