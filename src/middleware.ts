import { NextResponse, type NextRequest } from "next/server";
import { assetPath, legacyNonAssetRedirectPath, legacyTopicRedirectPath, tickerFromAssetSlug } from "@/lib/assetPath";

/**
 * Puts the language in the address.
 *
 * The language used to come from a cookie, so one address served either language
 * depending on who asked. A search engine sees one version of a page and no way to
 * discover the other, which put every Chinese translation beyond reach of search. Each
 * language now has its own address.
 *
 * The page tree is not duplicated to achieve that: `/zh/research` is rewritten to
 * `/research` on the way in, so the routes stay as they are and the locale is read from
 * the path the reader actually asked for, which is passed down in a header.
 */

const SEGMENTS = new Set(["en", "zh"]);
const LOCALE_COOKIE = "tline_locale";
const PRIVATE_PREFIXES = ["/admin", "/alerts", "/signin", "/account", "/watchlist"];

function cacheHeaders(response: NextResponse, request: NextRequest, pathname: string) {
  const authenticated = request.cookies.get("ii_session") || request.cookies.get("next-auth.session-token") || request.cookies.get("__Secure-next-auth.session-token");
  const privatePage = PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  response.headers.set("Vary", "Cookie, Accept-Language");
  response.headers.set("Cache-Control", request.method === "GET" && !authenticated && !privatePage
    ? "public, s-maxage=60, stale-while-revalidate=300"
    : "private, no-store");
  return response;
}

/**
 * Paths that are not pages and must never be given a language prefix.
 *
 * `sitemap` covers both the index at /sitemap.xml and the shards under /sitemap/1.xml: a
 * language prefix on a shard would make the index point at addresses that redirect.
 */
export const MACHINE_PATH = /^\/(?:api|_next|pdfjs|sitemap(?:\.xml)?|robots\.txt|llms(?:-full)?\.txt|(?:rss|feed)\.xml|favicon\.ico|icon|opengraph-image|apple-icon|manifest\.webmanifest)(?:\/|$|\.)/;

/**
 * The page an earlier shape of the site's address resolves to, or null if it still stands.
 *
 * The taxonomy was reorganised twice — a topic that turned out to be one asset became an
 * asset page, an alias like `fed` became the institution that owns the policy — and each
 * move left the old address answering two redirects: one from this middleware adding the
 * language, and a second from the route resolving the retired facet. Two 308s for one move
 * is a second fetch on a crawler that is already working through every address the site had
 * before it split by language.
 *
 * Resolving the facet here, before the prefix goes on, makes it one redirect from any entry
 * point. The route keeps its own check: this is an optimisation of the public address, not
 * the only place the rule lives, and a path that reaches the route unconverted still lands
 * in the same place.
 */
function resolvedLegacyPath(bare: string): string | null {
  const topic = /^\/topics\/([^/]+)$/.exec(bare);
  if (topic) return legacyTopicRedirectPath(decodeURIComponent(topic[1]));
  const asset = /^\/asset\/([^/]+)$/.exec(bare);
  if (asset) {
    const key = decodeURIComponent(asset[1]);
    return legacyNonAssetRedirectPath(tickerFromAssetSlug(key)) ?? assetPath(key);
  }
  return null;
}

function preferredSegment(request: NextRequest): string {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookie === "zh-CN") return "zh";
  if (cookie === "en") return "en";
  return /^zh\b/i.test(request.headers.get("accept-language")?.trim() ?? "") ? "zh" : "en";
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (MACHINE_PATH.test(pathname)) return NextResponse.next();

  // The Chinese section lives at /zh; /cn is accepted as an alias and redirected there so
  // a hand-typed or externally linked /cn address lands on the site instead of a 404.
  const cnAlias = /^\/cn(?=\/|$)/i.exec(pathname);
  if (cnAlias) {
    const url = request.nextUrl.clone();
    url.pathname = `/zh${pathname.slice(cnAlias[0].length)}`.replace(/\/$/, "") || "/zh";
    url.search = search;
    return NextResponse.redirect(url, 308);
  }

  // Retired sections (/consensus, /search) no longer exist. Send their old links to the
  // research feed in the same language rather than 308-ing them into a dead page.
  const retired = /^(?:\/(en|zh))?\/(?:consensus|search)(?:\/|$)/i.exec(pathname);
  if (retired) {
    const url = request.nextUrl.clone();
    url.pathname = `/${retired[1] ?? preferredSegment(request)}/research`;
    url.search = "";
    return NextResponse.redirect(url, 308);
  }

  const [, first, ...rest] = pathname.split("/");
  const prefixed = SEGMENTS.has(first ?? "");
  const bare = (prefixed ? `/${rest.join("/")}` : pathname).replace(/\/$/, "") || "/";
  const legacy = resolvedLegacyPath(bare);
  if (legacy) {
    const url = request.nextUrl.clone();
    // The language the reader is already in wins over the one they would be sent to: an
    // address that names a language names it for a reason, and the replacement page exists
    // in both.
    url.pathname = `/${prefixed ? first : preferredSegment(request)}${legacy}`;
    // The query belonged to the page being left behind; a facet change starts clean.
    url.search = "";
    return NextResponse.redirect(url, 308);
  }

  if (SEGMENTS.has(first ?? "")) {
    // Serve the existing route, while the pages below still see the address as asked for.
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}` || "/";
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    const response = cacheHeaders(NextResponse.rewrite(url, { request: { headers } }), request, `/${rest.join("/")}` || "/");
    // Remember the language the reader is actually viewing, so it sticks. Without this the
    // cookie is never written, the switch button never persists, and any address without a
    // prefix (the bare domain, a shared link, a reload) sends them back to their
    // Accept-Language default — the "switch doesn't work" bug. Only written when it changes,
    // so a returning reader with the right cookie keeps a cacheable response.
    const desired = first === "zh" ? "zh-CN" : "en";
    if (request.cookies.get(LOCALE_COOKIE)?.value !== desired) {
      response.cookies.set(LOCALE_COOKIE, desired, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    }
    return response;
  }

  // No language in the address: send the reader to the one they are likely to want. A
  // redirect rather than a rewrite, so that each page has exactly one address.
  const url = request.nextUrl.clone();
  url.pathname = `/${preferredSegment(request)}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
