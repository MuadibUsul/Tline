import { prisma } from "./db";
import { computeConsensus, consensusChange } from "./consensus";
import { ASSETS } from "./assets";

const FEATURED = ASSETS.filter((a) => a.featured).map((a) => a.ticker);
const DEDUPE_MS = 12 * 3600 * 1000;

export type AlertType =
  | "CONSENSUS_ABOVE"
  | "CONSENSUS_BELOW"
  | "CONSENSUS_DROP_24H"
  | "CONSENSUS_RISE_24H";

export function describeRule(r: { type: string; assetTicker: string | null; threshold: number }, locale = "en"): string {
  const zh = locale === "zh-CN";
  const scope = r.assetTicker ?? (zh ? "任一精选资产" : "any featured asset");
  switch (r.type) {
    case "CONSENSUS_ABOVE": return `${scope}${zh ? "共识" : " consensus"} ≥ ${r.threshold}`;
    case "CONSENSUS_BELOW": return `${scope}${zh ? "共识" : " consensus"} ≤ ${r.threshold}`;
    case "CONSENSUS_DROP_24H": return zh ? `${scope} 24小时共识下降 ≥ ${r.threshold}` : `${scope} consensus drops ≥ ${r.threshold} in 24h`;
    case "CONSENSUS_RISE_24H": return zh ? `${scope} 24小时共识上升 ≥ ${r.threshold}` : `${scope} consensus rises ≥ ${r.threshold} in 24h`;
    default: return `${scope} · ${r.type}`;
  }
}

interface Hit { assetTicker: string; assetName: string; score: number; message: string }

async function evalRuleForAsset(
  type: string,
  threshold: number,
  ticker: string,
): Promise<Hit | null> {
  const asset = await prisma.asset.findUnique({ where: { ticker } });
  if (!asset) return null;
  const c = await computeConsensus(asset.id);
  if (!c) return null;
  const ch = await consensusChange(asset.id, 1);

  const met =
    (type === "CONSENSUS_ABOVE" && c.score >= threshold) ||
    (type === "CONSENSUS_BELOW" && c.score <= threshold) ||
    (type === "CONSENSUS_DROP_24H" && ch !== null && ch <= -threshold) ||
    (type === "CONSENSUS_RISE_24H" && ch !== null && ch >= threshold);
  if (!met) return null;

  const chTxt = ch === null ? "" : ` (24h ${ch > 0 ? "+" : "−"}${Math.abs(ch)})`;
  return {
    assetTicker: ticker,
    assetName: asset.name,
    score: c.score,
    message: `${asset.name} consensus ${c.score} · ${c.label}${chTxt}`,
  };
}

/** Evaluate every active rule, writing de-duplicated AlertEvents. Returns fired count. */
export async function evaluateRules(): Promise<number> {
  const rules = await prisma.alertRule.findMany({ where: { active: true } });
  let fired = 0;

  for (const rule of rules) {
    const tickers = rule.assetTicker ? [rule.assetTicker] : FEATURED;
    for (const ticker of tickers) {
      const hit = await evalRuleForAsset(rule.type, rule.threshold, ticker);
      if (!hit) continue;

      const recent = await prisma.alertEvent.findFirst({
        where: { ruleId: rule.id, assetTicker: ticker, firedAt: { gte: new Date(Date.now() - DEDUPE_MS) } },
      });
      if (recent) continue;

      await prisma.alertEvent.create({
        data: { ruleId: rule.id, assetTicker: ticker, score: hit.score, message: hit.message },
      });
      fired++;
    }
  }
  return fired;
}
