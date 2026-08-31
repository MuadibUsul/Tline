import { prisma } from "../db";
import { stableStringify } from "./normalize";

export const MACRO_CONTEXT_METHODOLOGY = "macro-context-v1";
export type MacroAxis = "GROWTH" | "INFLATION" | "POLICY" | "LIQUIDITY";

export interface MacroContextInput {
  observationId: string;
  canonicalKey: string;
  category: string;
  value: string;
  period: Date;
  vintageAt: Date;
}

export function macroAxis(category: string): MacroAxis | null {
  if (category === "LABOR" || category === "GROWTH") return "GROWTH";
  if (category === "INFLATION" || category === "POLICY" || category === "LIQUIDITY") return category;
  return null;
}

export function buildMacroContext(inputs: MacroContextInput[]) {
  const axes: Record<MacroAxis, MacroContextInput[]> = { GROWTH: [], INFLATION: [], POLICY: [], LIQUIDITY: [] };
  for (const input of inputs) {
    const axis = macroAxis(input.category);
    if (axis) axes[axis].push(input);
  }
  for (const values of Object.values(axes)) values.sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey) || left.period.getTime() - right.period.getTime());
  return { axes, methodologyVersion: MACRO_CONTEXT_METHODOLOGY };
}

export async function storeMacroSignalSnapshot(inputObservationIds: string[], inputReleaseIds: string[], generatedAt = new Date(), scopeKey = "GLOBAL") {
  const observationIds = [...new Set(inputObservationIds)].sort();
  const releaseIds = [...new Set(inputReleaseIds)].sort();
  const [observations, releaseCount] = await Promise.all([
    prisma.macroObservation.findMany({ where: { id: { in: observationIds } }, select: { id: true, value: true, period: true, vintageAt: true, seriesSource: { select: { indicator: { select: { canonicalKey: true, category: true } } } } } }),
    prisma.macroRelease.count({ where: { id: { in: releaseIds } } }),
  ]);
  if (observations.length !== observationIds.length || releaseCount !== releaseIds.length) throw new Error("Macro signal snapshot inputs are incomplete.");
  const context = buildMacroContext(observations.map((row) => ({ observationId: row.id, canonicalKey: row.seriesSource.indicator.canonicalKey, category: row.seriesSource.indicator.category, value: row.value.toString(), period: row.period, vintageAt: row.vintageAt })));
  return prisma.macroSignalSnapshot.create({ data: { scopeKey, methodologyVersion: MACRO_CONTEXT_METHODOLOGY, generatedAt, contextJson: stableStringify(context), inputReleaseIds: stableStringify(releaseIds), inputObservationIds: stableStringify(observationIds) } });
}
