import { prisma } from "../db";
import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";
import { getReleaseConsensus } from "./releaseConsensus";

const SYSTEM = `You are a macro strategist writing a concise professional read-out of an economic data release for institutional readers.
Given the release facts (actual, previous, and the consensus mined from bank research with its distribution), write 300–400 words of analysis in BOTH English and Simplified Chinese.
Cover: whether the print beat/missed/matched the institutional consensus and by how much; the change vs the previous period; what it implies for the trajectory; and how it sits against the range of bank forecasts. Be factual and restrained. Do not give investment advice or price targets.
Return ONLY JSON: {"en":string,"zh":string}.`;

/** Generate and store the AI read-out for a released macro print. Idempotent-ish: overwrites. */
export async function generateReleaseAnalysis(
  releaseId: string,
  provider = getLLMProvider(process.env.FORECAST_PROVIDER ?? process.env.TRANSLATION_PROVIDER),
): Promise<boolean> {
  if (!provider) throw new Error("No LLM provider is configured for release analysis.");
  const release = await prisma.macroRelease.findUnique({
    where: { id: releaseId },
    include: { values: { include: { indicator: true } } },
  });
  if (!release) return false;
  const value = release.values[0];
  const consensus = await getReleaseConsensus(release);
  const facts = {
    indicator: value?.indicator ? value.indicator.nameEn : release.titleEn,
    unit: value?.indicator?.unit ?? consensus?.unit ?? "",
    referencePeriod: value?.observationPeriod?.toISOString().slice(0, 10) ?? null,
    actual: value?.actualInitial != null ? Number(value.actualInitial.toString()) : null,
    previous: value ? Number((value.revisedPreviousAtRelease ?? value.previousAtRelease)?.toString() ?? "") || null : null,
    institutionalConsensus: consensus?.median ?? null,
    consensusRange: consensus ? { min: consensus.min, max: consensus.max, count: consensus.count } : null,
    bankForecasts: consensus?.contributors.slice(0, 12) ?? [],
  };
  const { value: out } = await completeJSON<{ en?: string; zh?: string }>(provider, {
    system: SYSTEM,
    user: JSON.stringify(facts),
    maxTokens: 2000,
  });
  if (!out.en?.trim() && !out.zh?.trim()) return false;
  await prisma.macroRelease.update({
    where: { id: releaseId },
    data: { analysisEn: out.en?.trim() ?? null, analysisZh: out.zh?.trim() ?? null, analysisAt: new Date() },
  });
  return true;
}
