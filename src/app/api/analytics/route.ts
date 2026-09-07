import { getSessionUser } from "@/lib/auth";
import { isBot } from "@/lib/analytics/agent";
import { identify, record, type Beacon } from "@/lib/analytics/collect";
import { clientAddress } from "@/lib/analytics/identity";
import { rateLimit } from "@/lib/rateLimit";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * The one endpoint the analytics beacon posts to.
 *
 * It always answers 204 and it always answers immediately. A reader's browser has nothing
 * useful to do with an analytics error, and a page that waits on this call to finish has
 * been made slower by the thing measuring how fast it is.
 */

const LIMIT = Number(process.env.ANALYTICS_RATE_LIMIT || 120); // beacons per minute per address
const MAX_BODY = 4000;

function enabled() {
  return process.env.ANALYTICS_ENABLED !== "false";
}

function accepted() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Only this site's own pages may report. Not a security boundary — a filter for noise. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // sendBeacon on some browsers omits it
  try {
    return new URL(origin).host === new URL(siteUrl()).host || new URL(origin).hostname === "localhost";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!enabled() || !sameOrigin(request)) return accepted();

  const userAgent = request.headers.get("user-agent");
  if (isBot(userAgent)) return accepted();
  // Do-Not-Track is a request, not a requirement, and honouring it costs a fraction of a
  // percent of the numbers. Left configurable so a deployment can decide for its region.
  if (process.env.ANALYTICS_RESPECT_DNT === "true" && (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1")) {
    return accepted();
  }
  if (!rateLimit(`analytics:${clientAddress(request.headers)}`, LIMIT, 60_000).allowed) return accepted();

  // sendBeacon posts text/plain, so the body is read as text and parsed here rather than
  // relying on a content type the browser chooses.
  let beacon: Beacon;
  try {
    const body = await request.text();
    if (!body || body.length > MAX_BODY) return accepted();
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return accepted();
    beacon = parsed as Beacon;
  } catch {
    return accepted();
  }

  const user = await getSessionUser().catch(() => null);
  const visitor = identify(request.headers, beacon.session, user?.id ?? null);
  // Not awaited: the write is the caller's business only in the sense that they triggered
  // it, and a database hiccup must not become latency in someone's page. It is logged
  // though — a silent catch here is how a pipeline collects nothing for a week while
  // every beacon still answers 204.
  void record(beacon, visitor, request.headers).catch((error: unknown) => {
    console.warn(JSON.stringify({ event: "analytics.write_failed", error: String(error).slice(0, 300) }));
  });
  return accepted();
}
