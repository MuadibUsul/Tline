/**
 * Where a homepage placement may point.
 *
 * The admin form is the only writer, but the row is still read on every home-page render,
 * so the rule lives here and both sides ask it: a local path or an https URL, nothing
 * that a browser would run as script. `//host` is a protocol-relative URL, not a path.
 */
export interface AnnouncementLink {
  href: string;
  external: boolean;
}

export function announcementLink(raw: string): AnnouncementLink | null {
  const href = raw.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  if (href.startsWith("/")) {
    if (href.startsWith("//") || href.includes("\\")) return null;
    return { href, external: false };
  }
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return null;
    return { href: url.toString(), external: true };
  } catch {
    return null;
  }
}
