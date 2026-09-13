import { prisma } from "./db";
import { authorizedExpectationIds } from "./macro/expectationUse";
import { computeConsensus, consensusChange, consensusSince } from "./consensus";
import { ASSETS } from "./assets";
import { assetName, domainTerm, institutionName } from "./i18n";
import { publicationReadyWhere } from "./publication";
import { Prisma } from "@prisma/client";

const FEATURED = ASSETS.filter((asset) => asset.featured).map((asset) => asset.ticker);
const DEDUPE_MS = 12 * 3600 * 1000;

export type AlertType =
  | "CONSENSUS_ABOVE"
  | "CONSENSUS_BELOW"
  | "CONSENSUS_DROP_24H"
  | "CONSENSUS_RISE_24H"
  | "NEW_RESEARCH"
  | "MACRO_RELEASE"
  | "MACRO_SURPRISE_ABOVE"
  | "MACRO_SURPRISE_BELOW"
  | "MACRO_REVISION"
  | "CENTRAL_BANK_DECISION"
  | "POLICY_STANCE_CHANGE";

export type MonitorScopeKind = "asset" | "institution" | "theme" | "market" | "macro_indicator" | "macro_release_family" | "central_bank";

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
  const target = scope.ref
    ? scope.kind === "institution" ? institutionName(scope.ref, zh ? "zh-CN" : "en")
      : scope.kind === "asset" ? assetName(scope.ref, zh ? "zh-CN" : "en", scope.ref)
        : domainTerm(scope.ref, zh ? "zh-CN" : "en")
    : (zh ? "任一精选资产" : "any featured asset");
  if (rule.type === "MACRO_RELEASE") return zh ? `${target} 数据发布` : `${target} data release`;
  if (rule.type === "MACRO_SURPRISE_ABOVE") return zh ? `${target} 惊喜百分比 ≥ ${rule.threshold}%` : `${target} surprise ≥ ${rule.threshold}%`;
  if (rule.type === "MACRO_SURPRISE_BELOW") return zh ? `${target} 惊喜百分比 ≤ ${rule.threshold}%` : `${target} surprise ≤ ${rule.threshold}%`;
  if (rule.type === "MACRO_REVISION") return zh ? `${target} 数据发生修订` : `${target} data revision`;
  if (rule.type === "CENTRAL_BANK_DECISION") return zh ? `${target} 央行公布利率决议` : `${target} central-bank decision`;
  if (rule.type === "POLICY_STANCE_CHANGE") return zh ? `${target} 政策立场发生变化` : `${target} policy stance changes`;
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

const MACRO_TYPES = new Set(["MACRO_RELEASE", "MACRO_SURPRISE_ABOVE", "MACRO_SURPRISE_BELOW", "MACRO_REVISION", "CENTRAL_BANK_DECISION", "POLICY_STANCE_CHANGE"]);

export function surpriseThresholdMet(type: string, surprisePct: Prisma.Decimal.Value | null, thresholdPercent: number): boolean {
  if (surprisePct === null || !Number.isFinite(thresholdPercent)) return false;
  const percent = new Prisma.Decimal(surprisePct).times(100);
  return type === "MACRO_SURPRISE_ABOVE" ? percent.greaterThanOrEqualTo(thresholdPercent)
    : type === "MACRO_SURPRISE_BELOW" ? percent.lessThanOrEqualTo(thresholdPercent)
      : false;
}

type ParsedPolicy = { decision?: unknown; stance?: unknown; changeBps?: unknown };
function parsedPolicy(value: string | null): ParsedPolicy | null {
  if (!value) return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; }
}

export function stanceChanged(current: string | null, previous: string | null): boolean {
  return Boolean(current && previous && current !== "UNKNOWN" && previous !== "UNKNOWN" && current !== previous);
}

async function evalMacroRule(rule: RuleShape, scope: { kind: MonitorScopeKind; ref: string | null }): Promise<Hit | null> {
  if (!scope.ref) return null;
  const indicatorWhere = scope.kind === "macro_indicator" ? { canonicalKey: scope.ref } : undefined;
  if (rule.type === "MACRO_RELEASE" || rule.type.startsWith("MACRO_SURPRISE_")) {
    const release = await prisma.macroRelease.findFirst({
      where: {
        releasedAt: { not: null },
        ...(scope.kind === "macro_release_family" ? { releaseFamily: scope.ref } : {}),
        ...(indicatorWhere ? { values: { some: { indicator: indicatorWhere } } } : {}),
      },
      orderBy: { releasedAt: "desc" },
      include: { values: { where: indicatorWhere ? { indicator: indicatorWhere } : {}, include: { indicator: true, consensusExpectation: true } } },
    });
    if (!release) return null;
    if (rule.type === "MACRO_RELEASE") return { assetTicker: null, score: null, targetId: release.id, message: `${release.titleEn} released` };
    const authorized = await authorizedExpectationIds(release.values.flatMap((item) => item.consensusExpectation ? [item.consensusExpectation] : []), "internal_analysis");
    const value = release.values.find((item) => item.consensusExpectation && authorized.has(item.consensusExpectation.id) && item.consensusAtRelease !== null && surpriseThresholdMet(rule.type, item.surprisePct, rule.threshold));
    if (!value) return null;
    const percent = new Prisma.Decimal(value.surprisePct!).times(100).toDecimalPlaces(2).toString();
    return { assetTicker: null, score: null, targetId: release.id, message: `${value.indicator.nameEn} surprise ${percent}%` };
  }
  if (rule.type === "MACRO_REVISION" && indicatorWhere) {
    const observation = await prisma.macroObservation.findFirst({
      where: { revisionNo: { gt: 0 }, seriesSource: { indicator: indicatorWhere } },
      orderBy: [{ vintageAt: "desc" }, { revisionNo: "desc" }],
      include: { seriesSource: { include: { indicator: true } } },
    });
    return observation ? { assetTicker: null, score: null, targetId: observation.id, message: `${observation.seriesSource.indicator.nameEn} revised to ${observation.value.toString()}` } : null;
  }
  if ((rule.type === "CENTRAL_BANK_DECISION" || rule.type === "POLICY_STANCE_CHANGE") && scope.kind === "central_bank") {
    const documents = await prisma.macroPolicyDocument.findMany({ where: { centralBank: scope.ref, parsedJson: { not: null } }, orderBy: { publishedAt: "desc" }, take: 20 });
    const parsed = documents.map((document) => ({ document, policy: parsedPolicy(document.parsedJson) })).filter((item) => item.policy);
    if (!parsed.length) return null;
    if (rule.type === "CENTRAL_BANK_DECISION") {
      const current = parsed.find((item) => typeof item.policy!.decision === "string" && item.policy!.decision !== "OTHER");
      return current ? { assetTicker: null, score: null, targetId: current.document.releaseId ?? current.document.id, message: `${scope.ref} decision: ${String(current.policy!.decision)}${typeof current.policy!.changeBps === "number" ? ` (${current.policy!.changeBps} bps)` : ""}` } : null;
    }
    const stances = parsed.filter((item) => typeof item.policy!.stance === "string" && item.policy!.stance !== "UNKNOWN");
    if (stances.length < 2 || !stanceChanged(String(stances[0].policy!.stance), String(stances[1].policy!.stance))) return null;
    return { assetTicker: null, score: null, targetId: stances[0].document.releaseId ?? stances[0].document.id, message: `${scope.ref} stance: ${String(stances[1].policy!.stance)} → ${String(stances[0].policy!.stance)}` };
  }
  return null;
}

async function evalConsensusRule(type: string, threshold: number, ticker: string): Promise<Hit | null> {
  const asset = await prisma.asset.findUnique({ where: { ticker } });
  if (!asset) return null;
  const consensus = await computeConsensus(asset.id, { fallback: false });
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
      where: publicationReadyWhere({ publishedAt, articleAssets: { some: { asset: { ticker: scope.ref } } } }),
      orderBy: { publishedAt: "desc" },
      include: { institution: true },
    });
    return article ? { assetTicker: scope.ref, score: null, targetId: article.id, message: `${article.institution.name}: ${article.title}` } : null;
  }

  if (scope.kind === "institution") {
    const article = await prisma.article.findFirst({
      where: publicationReadyWhere({ publishedAt, institution: { slug: scope.ref } }),
      orderBy: { publishedAt: "desc" },
      include: { institution: true },
    });
    return article ? { assetTicker: null, score: null, targetId: article.id, message: `${article.institution.name}: ${article.title}` } : null;
  }

  const term = scope.ref.normalize("NFKD").toLocaleLowerCase();
  const articles = await prisma.article.findMany({
    where: publicationReadyWhere({ publishedAt }),
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
    const hits = MACRO_TYPES.has(rule.type)
      ? [await evalMacroRule(rule, scope)]
      : rule.type === "NEW_RESEARCH"
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
