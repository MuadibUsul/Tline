import { localeFromPath, stripLocale } from "../i18n";

/**
 * The address, reduced to the page it names.
 *
 * The query string goes: it is the one part of a URL that routinely carries a search
 * term, an email address or a token, and none of that belongs in an analytics table.
 * The language prefix goes too, so `/en/research` and `/zh/research` aggregate as one page
 * with the language recorded separately.
 */
const PATH_MAX = 300;

export function normalizePath(raw: unknown): { path: string; locale: string } | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 2000);
  if (!value) return null;
  let pathname: string;
  try {
    // Relative to a fixed base so an absolute URL pointing elsewhere still yields only
    // its path, and a caller cannot smuggle a host in through this field.
    pathname = new URL(value, "http://x").pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith("/")) return null;
  const locale = localeFromPath(pathname) ?? "en";
  const path = stripLocale(pathname).replace(/\/+$/, "") || "/";
  return { path: path.slice(0, PATH_MAX), locale };
}

/**
 * The page template and content id, so a report can say "articles" rather than only a
 * list of every URL. This is derived on the server from the normalised path; the browser
 * cannot claim to be a different template.
 */
export function pageMeta(path: string): { template: string; contentId: string | null } {
  const parts = path.split("/").filter(Boolean);
  const [first, second, third] = parts;
  const content = (value: string | undefined) => {
    if (!value) return null;
    try {
      return decodeURIComponent(value).slice(0, 160);
    } catch {
      return value.slice(0, 160);
    }
  };
  if (!first) return { template: "home", contentId: null };
  switch (first) {
    case "research":
      return parts.length === 1 ? { template: "research_index", contentId: null } : { template: "article", contentId: content(second) };
    case "news":
      if (second === "columns") return { template: "news_column", contentId: content(third) };
      return parts.length === 1 ? { template: "news_index", contentId: null } : { template: "news_article", contentId: content(second) };
    case "institution":
      return { template: "institution", contentId: content(second) };
    case "institutions":
    case "institutions-directory":
      return { template: "institutions_index", contentId: null };
    case "topics":
      return parts.length === 1 ? { template: "topics_index", contentId: null } : { template: "topic", contentId: content(second) };
    case "categories":
      return { template: "categories", contentId: content(second) };
    case "markets":
      return parts.length === 1 ? { template: "markets_index", contentId: null } : { template: "market", contentId: content(second) };
    case "asset":
      return { template: "market", contentId: content(second) };
    case "macro":
      return { template: "macro", contentId: content(second) };
    case "dashboards":
      return { template: "dashboards", contentId: content(second) };
    case "search":
      return { template: "search", contentId: null };
    case "about":
    case "methodology":
    case "privacy":
    case "sources":
    case "editorial":
      return { template: "about", contentId: first };
    case "signin":
      return { template: "auth", contentId: null };
    case "account":
    case "watchlist":
    case "alerts":
      return { template: "account", contentId: content(second) };
    default:
      return { template: "other", contentId: content(first) };
  }
}

/** Whether a path belongs to the operations console or a machine endpoint. */
export function isInternalPath(path: string): boolean {
  return /^\/(?:admin|api|_next|pdfjs)(?:\/|$)/.test(path) || /\.(?:js|css|png|jpe?g|webp|gif|svg|ico|woff2?|map)$/i.test(path);
}
