export interface TargetObservation {
  institutionId: string;
  target: number | null;
  timeHorizon: string | null;
}

/** A spread needs at least two institutions and only includes dated targets. */
export function buildTargetDistribution(rows: TargetObservation[]) {
  const latest = new Map<string, number>();
  for (const row of rows) {
    if (!latest.has(row.institutionId) && row.target != null && row.timeHorizon) latest.set(row.institutionId, row.target);
  }
  const targets = [...latest.values()].sort((a, b) => a - b);
  if (targets.length < 2) return null;
  return {
    low: targets[0],
    high: targets[targets.length - 1],
    median: targets[Math.floor(targets.length / 2)],
    avg: Math.round(targets.reduce((sum, target) => sum + target, 0) / targets.length),
  };
}
