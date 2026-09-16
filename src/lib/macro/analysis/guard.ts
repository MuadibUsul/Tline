import type { ReleaseFacts } from "./facts";

/**
 * What a read-out must not do, checked before anything is published.
 *
 * The rules exist because each of them was an actual published failure: prose that
 * narrated its own evidence classes instead of the market ("a verified pre-release survey
 * consensus, sourced from …"), numbers no one could check, and — the expensive one — a
 * read-out discarded entirely when a rule tripped, leaving a release with no analysis at
 * all. A rejection now comes with the violations attached, so a retry can fix them, and a
 * deterministic read-out takes over if it cannot.
 */
export interface ReadOut {
  headline: string;
  read: string;
  implication: string;
  watch: string;
}

/** Sentences about the process of writing, not about the economy. */
const META_PHRASES: Array<[RegExp, string]> = [
  [/\b(?:a\s+)?verified\s+(?:pre-?release\s+)?(?:survey\s+)?consensus\b/i, "narrates the consensus as evidence instead of using it"],
  [/\bevidence\s+class(?:es)?\b/i, "talks about evidence classes"],
  [/\bno\s+(?:platform\s+)?model\s+forecast\b/i, "lists what is missing rather than what the print means"],
  [/\bno\s+(?:institution\s+research\s+)?forecasts?\s+were\s+available\b/i, "lists what is missing rather than what the print means"],
  [/\b(?:this|the)\s+analysis\s+(?:is|was)\s+(?:automatically\s+)?generated\b/i, "describes its own generation"],
  [/\bcharacterisation\s+of\s+the\s+release\s+can\s+be\s+made\b/i, "describes what it cannot say"],
  [/证据分类|自动生成(?:的)?(?:解读|分析)/, "说明流程而非市场"],
  [/(?:本次)?(?:发布|数据|材料|报告)(?:中)?(?:并)?未(?:包含|提供|给出|公布)|无法量化|不予置评|暂无法评估/, "解释缺了什么，而不是数据说明什么"],
];

/** Publishing a view on a public account is not the same as advising a trade. */
/**
 * Rankings are the easiest statistic to invent, and the facts only support them when a
 * percentile or a deviation was actually computed. A claim of "highest on record" without
 * one is a fabrication even though it contains no digit.
 */
const RANKING = /(?:highest|lowest|biggest|largest|smallest|on record|since \d{4}|record (?:high|low))|最高分位|历史(?:最高|最低)|有记录以来|创(?:下)?(?:新)?(?:高|低)|是[^，。]{0,12}以来(?:最大|最小)/iu;

const ADVICE = /\b(?:we\s+(?:recommend|advise)|buy\s+the\s+dip|sell\s+(?:into|the)|price\s+target|target\s+price)\b|建议(?:买入|卖出|做多|做空)|目标价/iu;

const EXPECTATION_CLAIM = /\b(?:beat|miss(?:ed)?|above|below|exceed(?:ed)?|disappoint(?:ed)?|in[- ]line with|matched?)\s+(?:the\s+)?(?:market\s+)?(?:consensus|expectations?)\b|(?:超出|超过|高于|低于|不及|逊于|符合|持平于)(?:市场)?预期|超预期|不及预期/iu;

const MIN_READ = 120;
const MAX_READ = 2400;

/** Numbers a read-out may state besides the computed facts (calendar years, counts of periods). */
function isExcused(token: string) {
  if (/^(?:19|20)\d{2}$/.test(token)) return true;
  const value = Number(token);
  // Months, quarters, counts of releases, basis-point roundings of small changes.
  return Number.isFinite(value) && ((value >= 0 && value <= 12 && Number.isInteger(value)) || Math.abs(value) === 25 || Math.abs(value) === 50 || Math.abs(value) === 75);
}

export function unsupportedNumbers(text: string, facts: ReleaseFacts): string[] {
  const allowed = new Set(facts.allowedNumbers);
  const tokens = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const unsupported: string[] = [];
  for (const token of tokens) {
    if (isExcused(token)) continue;
    // A hyphen inside a range ("3.75-4 percent") is not a negative number, decimal places
    // are formatting rather than new information, and 423429 quoted as 423.4 in thousands is
    // the same figure. Each of those is a way the check would otherwise reject a true number.
    const value = Number(token);
    const forms = [
      token,
      token.replace(/^-/, ""),
      String(value),
      String(value.toFixed(2)),
      String(Math.abs(value)),
      String(Math.abs(value).toFixed(2)),
      String(Number((value * 1_000).toFixed(4))),
      String(Number((value / 1_000).toFixed(4))),
    ];
    if (forms.some((form) => allowed.has(form))) continue;
    if (!unsupported.includes(token)) unsupported.push(token);
  }
  return unsupported;
}

export interface GuardInput {
  readOut: ReadOut;
  facts: ReleaseFacts;
  /** Both locales' read-outs, since the claim rule applies to either. */
  otherLocale?: string;
}

export function readOutViolations(input: GuardInput): string[] {
  const { readOut, facts } = input;
  const violations: string[] = [];
  const prose = [readOut.headline, readOut.read, readOut.implication, readOut.watch].join("\n");
  if (!readOut.headline.trim()) violations.push("headline is empty");
  if (readOut.read.trim().length < MIN_READ) violations.push(`read is shorter than ${MIN_READ} characters`);
  if (readOut.read.length > MAX_READ) violations.push(`read is longer than ${MAX_READ} characters`);
  for (const [pattern, reason] of META_PHRASES) {
    if (pattern.test(prose)) violations.push(`removed meta-commentary required: ${reason}`);
  }
  if (ADVICE.test(prose)) violations.push("no investment advice or price targets");
  const hasRankingFact = facts.labels.some((label) => /percentile|deviation/i.test(label));
  if (RANKING.test(prose) && !hasRankingFact) violations.push("a ranking is claimed but no percentile or deviation was computed for this release");
  const paragraphs = readOut.read.split(/\n{2,}/).filter((part) => part.trim()).length;
  if (paragraphs > 4) violations.push(`the read has ${paragraphs} paragraphs; at most four`);
  const hasConsensus = facts.values.some((value) => value.consensus !== null);
  if (!hasConsensus && EXPECTATION_CLAIM.test(`${prose}\n${input.otherLocale ?? ""}`)) {
    violations.push("no survey consensus was recorded, so no claim about beating or missing expectations");
  }
  const unsupported = unsupportedNumbers(prose, facts);
  if (unsupported.length) violations.push(`numbers not present in the computed facts: ${unsupported.join(", ")}`);
  return violations;
}

/**
 * A read-out with no model in it, for when the model cannot produce an acceptable one.
 *
 * It is plain on purpose — the arithmetic, in order — because its job is to make sure a
 * release is never published with nothing to say, and because a reader can see exactly
 * what happened. The meta-phrase rule does not apply to it: it defines the evidence.
 */
export function fallbackReadOut(facts: ReleaseFacts, locale: "en" | "zh-CN" = "en"): ReadOut {
  const first = facts.values[0];
  const name = (value: ReleaseFacts["values"][number]) => locale === "zh-CN" ? value.nameZh ?? value.nameEn : value.nameEn;
  if (!first) {
    return locale === "zh-CN"
      ? { headline: `${facts.title} 已公布`, read: "本次发布未捕获到可比数值。", implication: facts.topic, watch: "等待下一次发布。" }
      : { headline: `${facts.title} was released`, read: "No comparable values were captured for this release.", implication: facts.topic, watch: "The next release of this series is the next comparable read." };
  }
  const zh = locale === "zh-CN";
  const headline = first.consensus === null
    ? zh ? `${name(first)} 录得 ${first.actual}${first.previous === null ? "" : `，前值 ${first.previous}`}` : `${name(first)} printed at ${first.actual}${first.previous === null ? "" : `, from ${first.previous}`}`
    : first.surprise === 0
      ? zh ? `${name(first)} 录得 ${first.actual}，与市场预期 ${first.consensus} 完全一致` : `${name(first)} printed at ${first.actual}, exactly the consensus of ${first.consensus}`
      : zh ? `${name(first)} 录得 ${first.actual}，${first.surprise! > 0 ? "高于" : "低于"}市场预期 ${first.consensus}` : `${name(first)} printed at ${first.actual}, ${first.surprise! > 0 ? "above" : "below"} the consensus of ${first.consensus}`;
  // The arithmetic, stated plainly and in the reader's language. The meta-phrase rules do
  // not apply here: this read-out exists to define the evidence rather than to interpret it.
  const sentences = facts.values.map((value) => {
    const parts: string[] = [];
    if (value.change !== null && value.previous !== null) {
      parts.push(zh
        ? `${name(value)} 由前值 ${value.previous} 变为 ${value.actual}，变动 ${value.change}`
        : `${name(value)} moved from ${value.previous} to ${value.actual}, a change of ${value.change}`);
    }
    if (value.surprise === null) {
      parts.push(zh ? `${name(value)} 未记录发布前调查预期` : `no survey consensus was recorded for ${name(value)}`);
    } else if (value.surprise === 0) {
      parts.push(zh ? `${name(value)} 与预期完全一致` : `${name(value)} matched the consensus exactly`);
    } else {
      parts.push(zh
        ? `${name(value)} ${value.surprise > 0 ? "高于" : "低于"}预期 ${Math.abs(value.surprise)}${value.surpriseSd === null ? "" : `（约 ${Math.abs(value.surpriseSd)} 个历史变动标准差）`}`
        : `${name(value)} ${value.surprise > 0 ? "above" : "below"} the consensus by ${Math.abs(value.surprise)}${value.surpriseSd === null ? "" : ` (${Math.abs(value.surpriseSd)} standard deviations of the historical change)`}`);
    }
    if (value.changePercentile !== null) parts.push(zh ? `${name(value)} 本次变动位于历史分布的 ${value.changePercentile} 分位` : `the change sits at the ${value.changePercentile}th percentile of its recorded changes`);
    if (value.momentum !== null) parts.push(zh ? `${value.momentumLabel === "three-period average change" ? "三期平均变动" : value.momentumLabel === "three-month annualised" ? "三个月折年率" : "三期累计变动"} ${value.momentum}` : `${value.momentumLabel} ${value.momentum}`);
    if (value.revision) parts.push(zh ? "该期数值在后续修订中发生变化" : value.revision);
    return `${parts.join(zh ? "；" : "; ")}。`;
  });
  return {
    headline,
    read: sentences.join(""),
    implication: facts.topic,
    watch: first.momentum === null
      ? zh ? "下一期数据是最直接的可比读数。" : "The next release of this series is the next comparable read."
      : zh ? `当前动量指标：${first.momentumLabel} ${first.momentum}。` : `${first.momentumLabel} stands at ${first.momentum}.`,
  };
}
