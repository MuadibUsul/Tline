export type SocialLanguage = "en" | "zh-CN";
export type SocialSourceKind = "research" | "macro";

const FORBIDDEN = /(?:guaranteed returns?|risk[- ]free profit|稳赚|保证收益|必涨|必跌)/i;

export function xWeightedLength(text: string): number {
  return [...text].reduce((sum, char) => sum + (/^[\u0000-\u10ff\u2000-\u200d\u2010-\u201f\u2032-\u2037]$/u.test(char) ? 1 : 2), 0);
}

export function fitX(text: string, limit = 275): string {
  const clean = text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (xWeightedLength(clean) <= limit) return clean;
  let out = "";
  for (const char of clean) {
    if (xWeightedLength(`${out}${char}…`) > limit) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

export function validatePost(text: string): string | null {
  if (!text.trim()) return "Post text is empty.";
  if (xWeightedLength(text) > 280) return "Post exceeds X's weighted 280-character limit.";
  if (/https?:\/\//i.test(text)) return "The main post must not contain a URL.";
  if (FORBIDDEN.test(text)) return "Post contains a prohibited promotional claim.";
  return null;
}

type ResearchInput = {
  title: string;
  institution: string;
  summaryEn: string;
  summaryZh: string;
  interpretationEn?: string | null;
  interpretationZh?: string | null;
};

export function researchPosts(input: ResearchInput) {
  return {
    en: fitX(`RESEARCH | ${input.institution}\n${input.title}\n\n${input.summaryEn}\n\nMarket read: ${input.interpretationEn || "See the sourced analysis for implications and risks."}`),
    zh: fitX(`研报 | ${input.institution}\n${input.title}\n\n${input.summaryZh}\n\n市场解读：${input.interpretationZh || "完整影响与风险请查看来源分析。"}`),
  };
}

type MacroValue = { nameEn: string; nameZh?: string | null; actual: string; consensus?: string | null; previous?: string | null };
type MacroInput = { titleEn: string; titleZh?: string | null; values: MacroValue[]; analysisEn: string; analysisZh: string };

function valueLine(value: MacroValue, zh: boolean) {
  const name = zh ? value.nameZh || value.nameEn : value.nameEn;
  const consensus = value.consensus ?? (zh ? "无" : "n/a");
  const previous = value.previous ?? (zh ? "无" : "n/a");
  return zh
    ? `${name}：实际 ${value.actual}｜预期 ${consensus}｜前值 ${previous}`
    : `${name}: actual ${value.actual} | consensus ${consensus} | previous ${previous}`;
}

export function macroPosts(input: MacroInput) {
  const enValues = input.values.slice(0, 2).map((value) => valueLine(value, false)).join("\n");
  const zhValues = input.values.slice(0, 2).map((value) => valueLine(value, true)).join("\n");
  return {
    en: fitX(`DATA | ${input.titleEn}\n${enValues}\n\n${input.analysisEn}`),
    zh: fitX(`数据公布 | ${input.titleZh || input.titleEn}\n${zhValues}\n\n${input.analysisZh}`),
  };
}
