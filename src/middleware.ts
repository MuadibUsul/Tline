import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the request path to the server components below.
 *
 * The root layout has to know which page is rendering so it can send an account that has
 * not chosen a password to the page where it does, without bouncing that page to itself.
 * Nothing else happens here: the check itself needs the database, which this cannot reach.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
