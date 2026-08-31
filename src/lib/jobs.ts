import { prisma } from "./db";

export async function runTrackedJob<T>(
  name: string,
  parameters: Record<string, unknown>,
  work: () => Promise<{ result: T; metrics?: Record<string, unknown> }>,
  attempt = Math.max(1, Number(process.env.JOB_ATTEMPT || 1)),
): Promise<T> {
  attempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
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
    const failureMetrics = error && typeof error === "object" && "metrics" in error ? (error as { metrics?: Record<string, unknown> }).metrics : undefined;
    await prisma.jobRun.update({
      where: { id: job.id },
      data: { status: "failed", ...(failureMetrics ? { metrics: JSON.stringify(failureMetrics) } : {}), error: String(error).slice(0, 4000), finishedAt: new Date() },
    });
    throw error;
  }
}
