/**
 * A sign-in return address that can only point back inside this site.
 *
 * `next` arrives from the query string. It must not become an open redirect, and it must
 * not be smuggled through encoded slashes/backslashes. Only a rooted path is accepted;
 * absolute URLs, protocol-relative URLs, backslashes and control characters fall back.
 */
export function safeReturnPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    if (decoded.length > 2048) return fallback;
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback;
    if (decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return fallback;
    }
  }
  return decoded;
}
