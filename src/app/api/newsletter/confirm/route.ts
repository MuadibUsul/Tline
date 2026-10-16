import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getLocale, localePath, type Locale } from "@/lib/i18n";
import { confirmSubscription, unsubscribeByToken } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

/**
 * The one endpoint both links of a newsletter email point at.
 *
 * GET, and side-effecting, which is deliberate: the link is clicked from a mail client
 * where a POST is not possible. What makes that safe is the token — 192 bits of randomness
 * minted per address, single purpose — and that both actions are idempotent: a second
 * confirmation click settles in the same state, and a second unsubscribe click cannot
 * silently resubscribe anyone. Every path ends in a redirect, so an email client that
 * prefetches links lands on a page rather than on an error.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const action = request.nextUrl.searchParams.get("action") === "unsubscribe" ? "unsubscribe" : "confirm";
  const result = action === "unsubscribe" ? await unsubscribeByToken(token) : await confirmSubscription(token);
  // The row's own locale when there is one, so the reader lands in the language they
  // subscribed in; a request without a row to read falls back to the request's own.
  const locale: Locale = result.locale ?? (await getLocale());
  redirect(`${localePath(locale, "/newsletter")}?status=${result.outcome}`);
}
