import { prisma } from "./db";
import { computeConsensus, consensusChange, consensusSince } from "./consensus";
import { ASSETS } from "./assets";

const FEATURED = ASSETS.filter((asset) => asset.featured).map((asset) => asset.ticker);
const DEDUPE_MS = 12 * 3600 * 1000;

export type AlertType =
  | "CONSENSUS_ABOVE"
  | "CONSENSUS_BELOW"
  | "CONSENSUS_DROP_24H"
  | "CONSENSUS_RISE_24H"
  | "NEW_RESEARCH";

export type MonitorScopeKind = "asset" | "institution" | "theme" | "market";

type RuleShape = {
  type: string;
  threshold: number;
  scopeKind?: string;
  scopeRef?: string | null;
  assetTicker?: string | null;
};

export function ruleScope(rule: RuleShape): { kind: MonitorScopeKind; ref: string | null } {
  if (rule.scopeRef) return { kind: rule.scopeKind as MonitorScopeKind, ref: rule.scopeRef };
  if (rule.assetTicker) return { kind: "asset", ref: rule.assetTicker };
  return { kind: "market", ref: null };
}

export function describeRule(rule: RuleShape, locale = "en"): string {
  const zh = locale === "zh-CN";
  const scope = ruleScope(rule);
  const target = scope.ref ?? (zh ? "任一精选资产" : "any featured asset");
  if (rule.type === "NEW_RESEARCH") {
    const kind = scope.kind === "institution" ? (zh ? "机构" : "institution") : scope.kind === "theme" ? (zh ? "交易主线" : "theme") : (zh ? "资产" : "asset");
    return zh ? `${kind}「${target}」发布相关新研报` : `new research for ${kind} “${target}”`;
  }
  switch (rule.type) {
    case "CONSENSUS_ABOVE": return `${target}${zh ? "共识" : " consensus"} ≥ ${rule.threshold}`;
    case "CONSENSUS_BELOW": return `${target}${zh ? "共识" : " consensus"} ≤ ${rule.threshold}`;
    case "CONSENSUS_DROP_24H": return zh ? `${target} 24小时共识下降 ≥ ${rule.threshold}` : `${target} consensus drops ≥ ${rule.threshold} in 24h`;
    case "CONSENSUS_RISE_24H": return zh ? `${target} 24小时共识上升 ≥ ${rule.threshold}` : `${target} consensus rises ≥ ${rule.threshold} in 24h`;
    default: return `${target} · ${rule.type}`;
  }
}

interface Hit {
  assetTicker: string | null;
  score: number | null;
  message: string;
  targetId?: string;
}

async function evalConsensusRule(type: string, threshold: number, ticker: string): Promise<Hit | null> {
  const asset = await prisma.asset.findUnique({ where: { ticker } });
  if (!asset) return null;
  const consensus = await computeConsensus(asset.id);
  if (!consensus) return null;
  const change = await consensusChange(asset.id, 1);
  const met =
    (type === "CONSENSUS_ABOVE" && consensus.score >= threshold) ||
    (type === "CONSENSUS_BELOW" && consensus.score <= threshold) ||
    (type === "CONSENSUS_DROP_24H" && change !== null && change <= -threshold) ||
    (type === "CONSENSUS_RISE_24H" && change !== null && change >= threshold);
  if (!met) return null;

  const changeText = change === null ? "" : ` (24h ${change > 0 ? "+" : "−"}${Math.abs(change)})`;
  return {
    assetTicker: ticker,
    score: consensus.score,
    message: `${asset.name} consensus ${consensus.score} · ${consensus.label}${changeText}`,
  };
}

async function evalResearchRule(scope: { kind: MonitorScopeKind; ref: string | null }): Promise<Hit | null> {
  if (!scope.ref || scope.kind === "market") return null;
  const publishedAt = { gte: consensusSince(), lte: new Date() };

  if (scope.kind === "asset") {
    const article = await prisma.article.findFirst({
      where: { publishedAt, articleAssets: { some: { asset: { ticker: scope.ref } } } },
      orderBy: { publishedAt: "desc" },
      include: { institution: true },
    });
    return article ? { assetTicker: scope.ref, score: null, targetId: article.id, message: `${article.institution.name}: ${article.title}` } : null;
  }

  if (scope.kind === "institution") {
    const article = await prisma.article.findFirst({
      where: { publishedAt, institution: { slug: scope.ref } },
      orderBy: { publishedAt: "desc" },
      include: { institution: true },
    });
    return article ? { assetTicker: null, score: null, targetId: article.id, message: `${article.institution.name}: ${article.title}` } : null;
  }

  const term = scope.ref.normalize("NFKD").toLocaleLowerCase();
  const articles = await prisma.article.findMany({
    where: { publishedAt },
    orderBy: { publishedAt: "desc" },
    take: 100,
    include: { institution: true, analysis: true, translations: { where: { locale: "zh-CN" }, take: 1 } },
  });
  const article = articles.find((candidate) => [
    candidate.title,
    candidate.rawText,
    candidate.analysis?.summary,
    candidate.translations[0]?.title,
    candidate.translations[0]?.text,
  ].some((value) => value?.normalize("NFKD").toLocaleLowerCase().includes(term)));
  return article ? { assetTicker: null, score: null, targetId: article.id, message: `${article.institution.name}: ${article.title}` } : null;
}

/** Evaluate every active monitoring rule and write de-duplicated events. */
export async function evaluateRules(): Promise<number> {
  const rules = await prisma.alertRule.findMany({ where: { active: true } });
  let fired = 0;

  for (const rule of rules) {
    const scope = ruleScope(rule);
    const hits = rule.type === "NEW_RESEARCH"
      ? [await evalResearchRule(scope)]
      : await Promise.all((scope.kind === "asset" && scope.ref ? [scope.ref] : FEATURED)
        .map((ticker) => evalConsensusRule(rule.type, rule.threshold, ticker)));

    for (const hit of hits) {
      if (!hit) continue;
      const duplicate = await prisma.alertEvent.findFirst({
        where: hit.targetId
          ? { ruleId: rule.id, targetId: hit.targetId }
          : { ruleId: rule.id, assetTicker: hit.assetTicker, firedAt: { gte: new Date(Date.now() - DEDUPE_MS) } },
      });
      if (duplicate) continue;

      await prisma.alertEvent.create({
        data: { ruleId: rule.id, targetId: hit.targetId, assetTicker: hit.assetTicker, score: hit.score, message: hit.message },
      });
      fired += 1;
    }
  }
  return fired;
}
