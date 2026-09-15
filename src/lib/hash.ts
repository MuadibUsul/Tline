import { createHash } from "node:crypto";

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/** Strip tracking params, AMP suffixes, fragments and trailing slashes. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const drop = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i, /^ref$/i, /^source$/i];
    for (const key of [...u.searchParams.keys()]) {
      if (drop.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    let path = u.pathname.replace(/\/amp\/?$/i, "/").replace(/\.amp$/i, "");
    // State Street (SSGA) publishes the same report on regional sites — /nz/en_gb, /sg/en,
    // /hk/en, /us/en, each a distinct URL — so a single report was ingested several times.
    // Drop the leading region/language pair so those copies share one canonical URL and
    // dedup to a single report. The real regional sourceUrl is still stored for the link.
    if (/(?:^|\.)ssga\.com$/i.test(u.host)) {
      path = path.replace(/^\/[a-z]{2}\/[a-z]{2}(?:_[a-z]{2})?(?=\/)/i, "");
    }
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
}

export function urlHash(url: string): string {
  return sha1(canonicalizeUrl(url));
}
export function titleHash(title: string): string {
  return sha1(normalizeText(title));
}
export function contentHash(text: string): string {
  // Shingle the first ~2k normalized chars — resilient to minor edits / reposts.
  return sha1(normalizeText(text).slice(0, 2000));
}
