import { prisma } from "./db";

export async function runTrackedJob<T>(
  name: string,
  parameters: Record<string, unknown>,
  work: () => Promise<{ result: T; metrics?: Record<string, unknown> }>,
  attempt = 1,
): Promise<T> {
  const job = await prisma.jobRun.create({
    data: { name, attempt, parameters: JSON.stringify(parameters) },
  });
  try {
    const { result, metrics = {} } = await work();
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { status: "succeeded", metrics: JSON.stringify(metrics), finishedAt: new Date() },
    });
    return result;
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { status: "failed", error: String(error).slice(0, 4000), finishedAt: new Date() },
    });
    throw error;
  }
}
