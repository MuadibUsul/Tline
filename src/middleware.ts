import { NextResponse, type NextRequest } from "next/server";

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

/** Paths that are not pages and must never be given a language prefix. */
const UNPREFIXED = /^\/(?:api|_next|pdfjs|sitemap\.xml|robots\.txt|favicon\.ico|icon|opengraph-image|apple-icon)(?:\/|$|\.)/;

function preferredSegment(request: NextRequest): string {
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookie === "zh-CN") return "zh";
  if (cookie === "en") return "en";
  return /^zh\b/i.test(request.headers.get("accept-language")?.trim() ?? "") ? "zh" : "en";
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (UNPREFIXED.test(pathname)) return NextResponse.next();

  const [, first, ...rest] = pathname.split("/");
  if (SEGMENTS.has(first ?? "")) {
    // Serve the existing route, while the pages below still see the address as asked for.
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}` || "/";
    const headers = new Headers(request.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // No language in the address: send the reader to the one they are likely to want. A
  // redirect rather than a rewrite, so that each page has exactly one address.
  const url = request.nextUrl.clone();
  url.pathname = `/${preferredSegment(request)}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
