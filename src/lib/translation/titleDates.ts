// Deterministic date handling for research titles.
//
// LLM translation reliably mangles English dates inside short titles
// (e.g. "31 Aug 2026" -> "31年2026月", losing the month). We protect whole
// date expressions before translation and restore them as clean Simplified
// Chinese dates afterwards, and repair titles that were stored before this.

const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const monthNumber = (name: string) => MONTH_INDEX[name.slice(0, 3).toLowerCase()];

export function formatChineseDate(year: number, month: number, day?: number) {
  return day ? `${year}年${month}月${day}日` : `${year}年${month}月`;
}

// English date expressions, most specific first. Each yields {year, month, day?}.
const EN_DATE_PATTERNS: Array<{ re: RegExp; read: (m: RegExpExecArray) => { y: number; mo: number; d?: number } | null }> = [
  { re: new RegExp(`\\b(\\d{1,2})\\s+${MONTH}\\.?\\s+(\\d{4})\\b`, "gi"), read: (m) => ({ d: Number(m[1]), mo: monthNumber(m[2]), y: Number(m[3]) }) },
  { re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), read: (m) => ({ mo: monthNumber(m[1]), d: Number(m[2]), y: Number(m[3]) }) },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, read: (m) => ({ y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }) },
  { re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{4})\\b`, "gi"), read: (m) => ({ mo: monthNumber(m[1]), y: Number(m[2]) }) },
];

const valid = (v: { y: number; mo: number; d?: number } | null) =>
  Boolean(v) && v!.mo >= 1 && v!.mo <= 12 && (v!.d === undefined || (v!.d >= 1 && v!.d <= 31)) && v!.y >= 1900 && v!.y <= 3000;

function toChineseDates(text: string): string | string[] {
  // Convert the first English date expression in `text` to a Chinese date.
  for (const { re, read } of EN_DATE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      const v = read(m);
      if (valid(v)) return formatChineseDate(v!.y, v!.mo, v!.d);
    }
  }
  return "";
}

/** First English date in a title, formatted as a Chinese date, or null. */
export function chineseDateFromEnglishTitle(title: string): string | null {
  const zh = toChineseDates(title);
  return typeof zh === "string" && zh ? zh : null;
}

const marker = (index: number) => `__TLD_${String.fromCharCode(65 + index)}__`; // alpha marker survives number protection

/** Replace English date expressions in a title with alpha placeholders, pushing the Chinese form. */
export function protectTitleDates(title: string, dates: string[]): string {
  let result = title;
  for (const { re, read } of EN_DATE_PATTERNS) {
    const scan = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    const edits: Array<{ start: number; end: number; placeholder: string }> = [];
    while ((m = scan.exec(result))) {
      if (dates.length >= 26) break; // placeholder space exhausted (never happens for real titles)
      const v = read(m);
      if (!valid(v)) continue;
      const placeholder = marker(dates.length);
      edits.push({ start: m.index, end: m.index + m[0].length, placeholder });
      dates.push(formatChineseDate(v!.y, v!.mo, v!.d));
    }
    for (const edit of edits.reverse()) {
      result = result.slice(0, edit.start) + edit.placeholder + result.slice(edit.end);
    }
  }
  return result;
}

export function restoreTitleDates(text: string, dates: string[]): string {
  return text.replace(/__TLD_([A-Z])__/g, (m, letter: string) => dates[letter.charCodeAt(0) - 65] ?? m);
}

// Garbled or untranslated date fragments left in stored Chinese titles.
const GARBLED_ZH_DATE = new RegExp(
  [
    "\\d{1,2}\\s*年\\s*\\d{4}\\s*月(?:\\s*\\d{1,2}\\s*日)?", // "21年2026月1日", "31年2026月"
    "\\d{1,2}\\s*[一二三四五六七八九十]+月\\s*\\d{4}",        // "31 八月 2026"
    `\\d{1,2}\\s+${MONTH}\\.?\\s+\\d{4}`,                     // "31 Aug 2026" left untranslated
    `${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}`,                   // "Aug 31, 2026" left untranslated
  ].join("|"),
  "i",
);

/** Repair a stored Chinese title by re-deriving its date from the intact English title. No LLM. */
export function repairChineseTitleDate(zhTitle: string, englishTitle: string): string {
  const correct = chineseDateFromEnglishTitle(englishTitle);
  if (!correct) return zhTitle;
  return zhTitle.replace(GARBLED_ZH_DATE, correct);
}

/** Whether a Chinese title still carries a garbled/foreign date fragment. */
export function hasGarbledTitleDate(zhTitle: string): boolean {
  return GARBLED_ZH_DATE.test(zhTitle);
}
