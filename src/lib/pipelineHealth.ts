import { prisma } from "./db";

export interface PipelineHealth {
  articleAgeHours: number | null;
  viewAgeHours: number | null;
  crawlableSources: number;
  workingSources: number;
  stalled: string[];
}

export function stallReasons(
  input: Omit<PipelineHealth, "stalled">,
  stallHours = Math.max(1, Number(process.env.INGEST_STALL_HOURS || 6)),
  viewStallHours = Math.max(1, Number(process.env.VIEW_STALL_HOURS || 12)),
) {
  const reasons: string[] = [];
  if (input.articleAgeHours === null) reasons.push("no research has ever been stored");
  else if (input.articleAgeHours > stallHours) reasons.push(`no research stored for ${input.articleAgeHours.toFixed(1)}h`);
  if (input.articleAgeHours !== null && input.viewAgeHours !== null && input.viewAgeHours > viewStallHours) {
    reasons.push(`no views extracted for ${input.viewAgeHours.toFixed(1)}h`);
  }
  if (input.crawlableSources > 0 && input.workingSources === 0) reasons.push("no source has succeeded in 24h");
  return reasons;
}

const hoursSince = (value: Date | null) => (value ? (Date.now() - value.getTime()) / 3_600_000 : null);

export async function pipelineHealth(): Promise<PipelineHealth> {
  const [article, view, crawlableSources, workingSources] = await Promise.all([
    prisma.article.aggregate({ _max: { createdAt: true } }),
    prisma.atomicView.aggregate({ _max: { createdAt: true } }),
    prisma.institution.count({ where: { monitoringEnabled: true, crawlPolicy: { in: ["allowed", "delayed"] } } }),
    prisma.institution.count({ where: { lastSuccessAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } }),
  ]);
  const input = {
    articleAgeHours: hoursSince(article._max.createdAt),
    viewAgeHours: hoursSince(view._max.createdAt),
    crawlableSources,
    workingSources,
  };
  return { ...input, stalled: stallReasons(input) };
}
