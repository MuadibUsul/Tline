import { prisma } from "../db";
import { classify } from "./agent";
import { clientAddress, dayKey, visitorHash } from "./identity";

/**
 * Records an event from a server route rather than from the browser.
 *
 * Some of the things worth counting never reach the beacon: a PDF download is a redirect
 * or a byte stream, not a page, and a sign-in ends in a redirect that unmounts the page
 * that would have reported it. Those are recorded where they actually happen. The
 * identity is derived exactly as the beacon's is, so a download and a page view attribute
 * to the same visitor on the same day.
 *
 * Never awaited by the caller and never allowed to throw: measurement does not get to
 * fail a download.
 */
export function trackServerEvent(
  name: string,
  headers: Headers,
  options: { userId?: string | null; path?: string | null; value?: number | null; metadata?: Record<string, unknown> } = {},
) {
  if (process.env.ANALYTICS_ENABLED === "false") return;
  const userAgent = headers.get("user-agent") ?? "";
  // A crawler fetching a PDF is not an audience, and it would otherwise be the loudest
  // "reader" in the table.
  if (classify(userAgent).bot) return;

  void prisma.analyticsEvent
    .create({
      data: {
        day: dayKey(),
        name: name.slice(0, 80),
        path: options.path?.slice(0, 300) ?? null,
        visitorId: visitorHash(clientAddress(headers), userAgent),
        // There is no tab to ask, so the visitor stands in for the session: a server-side
        // event belongs to a person on a day, which is all these are counted by.
        sessionId: "server",
        userId: options.userId ?? null,
        value: options.value ?? null,
        metadata: JSON.stringify(options.metadata ?? {}).slice(0, 1000),
      },
    })
    .catch((error: unknown) => {
      console.warn(JSON.stringify({ event: "analytics.server_event_failed", name, error: String(error).slice(0, 300) }));
    });
}
