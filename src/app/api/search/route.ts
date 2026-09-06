import { NextResponse } from "next/server";
import { searchSite } from "@/lib/search";
import { resolveLocale } from "@/lib/i18n";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// A cold search builds an in-memory index over the whole published corpus, so this
// endpoint is far more expensive than its response size suggests. Keep it usable for
// type-ahead (a burst per keystroke) while denying a single caller a sustained flood.
const SEARCH_LIMIT = Math.max(1, Number(process.env.SEARCH_RATE_LIMIT || 30));
const SEARCH_WINDOW_MS = Math.max(1_000, Number(process.env.SEARCH_RATE_WINDOW_MS || 60_000));

export async function GET(request: Request) {
  const { allowed, remaining, retryAfterSeconds } = rateLimit(
    `search:${clientKey(request)}`,
    SEARCH_LIMIT,
    SEARCH_WINDOW_MS,
  );
  if (!allowed) {
    return NextResponse.json({ results: [], error: "rate_limited" }, {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds), "cache-control": "no-store" },
    });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const locale = resolveLocale(url.searchParams.get("locale") ?? undefined);
  const headers = {
    "cache-control": "no-store",
    "x-ratelimit-limit": String(SEARCH_LIMIT),
    "x-ratelimit-remaining": String(remaining),
  };
  if (query.length < 2) return NextResponse.json({ results: [] }, { headers });
  const startedAt = performance.now();
  const results = await searchSite(query, 12, locale);
  return NextResponse.json({ results }, {
    headers: { ...headers, "server-timing": `search;dur=${(performance.now() - startedAt).toFixed(1)}` },
  });
}
