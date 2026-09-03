import { pinyin } from "pinyin-pro";

/**
 * Pinyin forms of a Chinese string, so a Latin-keyboard query can reach Chinese text.
 *
 * Two forms are kept because people type both: the full reading ("huangjin") and the
 * initials ("hj"), which is how a Chinese input method is usually driven. Tones are
 * dropped — nobody types them into a search box.
 */

export interface PinyinForms {
  /** Syllables joined without separators: 黄金 -> "huangjin". */
  full: string;
  /** First letter of each syllable: 黄金 -> "hj". */
  initials: string;
}

const HAS_CHINESE = /[一-鿿]/;

export function hasChinese(value: string) {
  return HAS_CHINESE.test(value);
}

// Converting a string costs a dictionary lookup per character, and the search index
// converts the same institution and asset names on every rebuild.
const cache = new Map<string, PinyinForms>();
const CACHE_LIMIT = 20_000;

export function pinyinForms(value: string): PinyinForms {
  const text = value.trim();
  if (!text || !HAS_CHINESE.test(text)) return { full: "", initials: "" };

  const cached = cache.get(text);
  if (cached) return cached;

  // Latin runs already in the text come back unchanged, so they stay searchable in the
  // pinyin form too: "美联储FOMC" yields "meilianchufomc".
  const syllables = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" });
  const forms: PinyinForms = {
    full: syllables.join("").toLowerCase().replace(/[^a-z0-9]/g, ""),
    initials: syllables
      .map((syllable) => syllable.trim()[0] ?? "")
      .join("")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  };

  // A plain cap rather than an eviction policy: the working set is the corpus's names,
  // and dropping the whole map costs one rebuild.
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, forms);
  return forms;
}

/** Whether a query could be someone typing pinyin rather than English. */
export function looksLikePinyinQuery(query: string) {
  return /^[a-z]{2,}$/.test(query.replace(/\s+/g, ""));
}

/**
 * How well a Latin query matches a Chinese string's pronunciation, 0 when it does not.
 *
 * Scores sit below an exact text match on purpose: someone who typed the characters
 * themselves has said more about what they want than someone who typed "hj".
 */
export function scorePinyin(query: string, forms: PinyinForms): number {
  const q = query.replace(/\s+/g, "").toLowerCase();
  // One letter is a prefix of half the corpus; it says nothing about intent.
  if (q.length < 2 || !forms.full) return 0;

  if (forms.full === q) return 96;
  if (forms.full.startsWith(q)) return 84;
  // Only worth reporting when the query is a decent share of the word; otherwise every
  // long name contains every short query somewhere.
  if (q.length >= 4 && forms.full.includes(q)) return 62;

  // Initials are terse enough to collide, so they must match from the start, and a
  // one-letter query is not evidence of anything.
  if (forms.initials.length >= 2 && q.length >= 2) {
    if (forms.initials === q) return 78;
    if (forms.initials.startsWith(q)) return 58;
  }
  return 0;
}
