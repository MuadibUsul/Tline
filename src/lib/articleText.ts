const DISCLAIMER_STARTS = [
  /(?:^|\n\s*\n)this (?:content|material) is marketing material\b/i,
  /(?:^|\n\s*\n)(?:legal )?disclaimer\s*[:：]?\s*(?=\S)/i,
  /(?:^|\n\s*\n)(?:本内容|本材料)(?:为|是)营销材料[。；]?/,
  /(?:^|\n\s*\n)(?:法律)?免责声明\s*[:：]?\s*(?=\S)/,
];

const LEGAL_MARKERS = [
  /for informational purposes only/i,
  /does not constitute.{0,80}(?:offer|advice|recommendation)/i,
  /past (?:investment )?performance.{0,80}(?:future|guarantee)/i,
  /(?:accuracy|completeness).{0,80}(?:not guaranteed|no guarantee)/i,
  /(?:assumes?|accepts?) no liability/i,
  /does not meet.{0,80}(?:independent )?research/i,
  /仅供参考|仅供信息参考/,
  /不构成.{0,80}(?:要约|建议|推荐)/,
  /过往表现.{0,80}(?:未来|保证)/,
  /不保证.{0,80}(?:准确|完整)/,
  /不(?:承担|负).{0,80}责任/,
  /不符合.{0,80}独立研究/,
];

const DISCLAIMER_HEADING = /^(?:important (?:legal )?(?:information|notice)|(?:legal )?disclaimers?|免责声明|重要(?:法律)?信息)\b/i;
const RELATED_HEADING = /^(?:explore the latest|related (?:insights|articles|content)|read (?:this )?next|latest (?:market )?insights|more (?:from|insights)|recommended (?:for you|articles))/i;

function disclaimerStart(text: string): number {
  let start = -1;
  for (const pattern of DISCLAIMER_STARTS) {
    const index = text.search(pattern);
    if (index >= 0 && (start < 0 || index < start)) start = index;
  }
  const openingParagraph = text.split(/\n\s*\n/, 1)[0];
  if (LEGAL_MARKERS.filter((pattern) => pattern.test(openingParagraph)).length >= 2) start = 0;
  for (const match of text.matchAll(/\n\s*\n/g)) {
    const index = match.index + match[0].length;
    const suffix = text.slice(index);
    const firstParagraph = suffix.split(/\n\s*\n/, 1)[0];
    const firstHits = LEGAL_MARKERS.filter((pattern) => pattern.test(firstParagraph)).length;
    const suffixHits = LEGAL_MARKERS.filter((pattern) => pattern.test(suffix)).length;
    if ((firstHits >= 2 || (firstHits >= 1 && suffixHits >= 3)) && (start < 0 || index < start)) start = index;
  }
  return start;
}

export function splitTrailingDisclaimer(text: string, priorContentLength = 0): { body: string; disclaimer: string | null } {
  const start = disclaimerStart(text);
  if (start < 0 || priorContentLength + start < 120) return { body: text, disclaimer: null };
  return { body: text.slice(0, start).trim(), disclaimer: text.slice(start).trim() || null };
}

export function partitionArticleSegments<T extends { heading?: string | null; text: string }>(segments: T[]): {
  body: T[];
  disclaimer: string | null;
} {
  const body: T[] = [];
  const legal: string[] = [];
  let keptLength = 0;
  let bodyEnded = false;
  for (const segment of segments) {
    const heading = segment.heading?.trim() || "";
    if (RELATED_HEADING.test(heading)) { bodyEnded = true; continue; }
    if (DISCLAIMER_HEADING.test(heading)) {
      if (segment.text.trim()) legal.push(segment.text.trim());
      break;
    }
    if (bodyEnded) {
      const trailing = splitTrailingDisclaimer(segment.text, keptLength);
      if (trailing.disclaimer) { legal.push(trailing.disclaimer); break; }
      continue;
    }
    const split = splitTrailingDisclaimer(segment.text, keptLength);
    if (split.body) {
      body.push(split.body === segment.text ? segment : { ...segment, text: split.body });
      keptLength += split.body.length;
    }
    if (split.disclaimer) {
      legal.push(split.disclaimer);
      break;
    }
  }
  return { body, disclaimer: legal.join("\n\n") || null };
}

/** Remove a publisher's trailing legal boilerplate while preserving real article content. */
export function stripTrailingDisclaimer(text: string, priorContentLength = 0): string {
  return splitTrailingDisclaimer(text, priorContentLength).body;
}

export function stripTrailingDisclaimerSegments<T extends { text: string }>(segments: T[]): T[] {
  return partitionArticleSegments(segments).body;
}
