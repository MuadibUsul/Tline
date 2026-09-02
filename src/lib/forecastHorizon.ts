/**
 * Turn a research time horizon into a settlement date.
 *
 * The extractor records whatever wording the institution used — "short_term",
 * "3-6 months", "H2 2026", "2026年12月", "end-2027". The original mapping recognised only
 * four canonical codes (1W/1M/3M/12M), which no extracted horizon ever matched, so every
 * forecast was silently dropped before it was created.
 *
 * Anything genuinely unspecified ("coming quarters", "over time", "unknown") still returns
 * null. Inventing a date for a horizon the institution never gave would fabricate the very
 * accuracy record this table exists to measure.
 */
const DAY_MS = 86_400_000;

const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30, months: 30,
  quarter: 91, quarters: 91,
  year: 365, years: 365,
};

/** Qualitative horizons, using the conventional sell-side reading of each band. */
const QUALITATIVE: Array<[RegExp, number]> = [
  [/^(?:near|short)[\s_-]?term$/, 30],
  [/^tactical$/, 30],
  [/^(?:short|near)[\s_-]?to[\s_-]?intermediate[\s_-]?term$/, 60],
  [/^(?:medium|intermediate|mid)[\s_-]?term$/, 90],
  [/^(?:long)[\s_-]?term$/, 365],
  [/^strategic$/, 365],
];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Last instant of a month, in UTC. */
function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function clean(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(].*?[)）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteDate(text: string, start: Date): Date | null {
  const year = (value: string) => Number(value);

  // 2026-12-31 / 2026/12/31
  const full = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (full) return new Date(Date.UTC(year(full[1]), Number(full[2]) - 1, Number(full[3]), 23, 59, 59, 999));

  // 2026-12 / 2026年12月
  const yearMonth = text.match(/^(\d{4})[-/](\d{1,2})$/) ?? text.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月$/);
  if (yearMonth) return endOfMonth(year(yearMonth[1]), Number(yearMonth[2]));

  // july 2026
  const namedMonth = text.match(/^([a-z]+)\s+(\d{4})$/);
  if (namedMonth && MONTHS[namedMonth[1]]) return endOfMonth(year(namedMonth[2]), MONTHS[namedMonth[1]]);

  // q3 2026 / 2026 q3
  const quarter = text.match(/^q([1-4])\s*(\d{4})$/) ?? text.match(/^(\d{4})\s*q([1-4])$/);
  if (quarter) {
    const [q, y] = /^q/.test(text) ? [Number(quarter[1]), year(quarter[2])] : [Number(quarter[2]), year(quarter[1])];
    return endOfMonth(y, q * 3);
  }

  // h1 2027 / 2026h2
  const half = text.match(/^h([12])\s*(\d{4})$/) ?? text.match(/^(\d{4})\s*h([12])$/);
  if (half) {
    const [h, y] = /^h/.test(text) ? [Number(half[1]), year(half[2])] : [Number(half[2]), year(half[1])];
    return endOfMonth(y, h * 6);
  }

  // 2026 / end-2027 / 2026 end / 2026 year-end / end of 2025 / remainder of 2026 / rest of 2026
  const bareYear = text.match(/^(?:end[\s-]?(?:of[\s-]?)?|remainder of |rest of )?(\d{4})(?:\s*(?:end|year[\s-]?end))?$/);
  if (bareYear) return endOfMonth(year(bareYear[1]), 12);

  // year-end, with no year given: the next 31 December after the report.
  if (/^(?:year[\s-]?end|end of (?:the )?year)$/.test(text)) {
    return endOfMonth(start.getUTCFullYear(), 12);
  }

  // A bare month name: the next occurrence of it after the report date.
  if (MONTHS[text]) {
    const month = MONTHS[text];
    const sameYear = endOfMonth(start.getUTCFullYear(), month);
    return sameYear > start ? sameYear : endOfMonth(start.getUTCFullYear() + 1, month);
  }

  return null;
}

function relativeDays(text: string): number | null {
  // 3-6 months / next 8-10 weeks / 12-24 months → the midpoint of the stated band
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*([a-z]+)/);
  if (range && UNIT_DAYS[range[3]]) {
    return ((Number(range[1]) + Number(range[2])) / 2) * UNIT_DAYS[range[3]];
  }

  // 12 months / 1 week / next 12 months / 3-5 years handled by the range branch above
  const single = text.match(/(\d+)\s*([a-z]+)/);
  if (single && UNIT_DAYS[single[2]]) return Number(single[1]) * UNIT_DAYS[single[2]];

  // Canonical codes kept for compatibility with anything already using them.
  const code = text.toUpperCase().match(/^(\d+)([WMYQ])$/);
  if (code) {
    const unit = { W: 7, M: 30, Q: 91, Y: 365 }[code[2] as "W" | "M" | "Y" | "Q"];
    return Number(code[1]) * unit;
  }

  for (const [pattern, days] of QUALITATIVE) if (pattern.test(text)) return days;
  return null;
}

export function horizonTargetDate(start: Date, horizon: string | null | undefined): Date | null {
  if (!horizon) return null;
  const text = clean(horizon);
  if (!text || /^(?:unknown|not specified|n\/a|none)$/.test(text)) return null;

  const absolute = absoluteDate(text, start);
  // A date already in the past at publication is a parse artifact, not a forecast.
  if (absolute) return absolute > start ? absolute : null;

  const days = relativeDays(text);
  if (days === null) return null;
  return new Date(start.getTime() + Math.round(days) * DAY_MS);
}
