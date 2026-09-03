import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { feedPulse } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Identifies this running server, and so this deployment.
 *
 * A page left open across a release holds script references the new build no longer
 * serves; asking it to refresh in place then fails on a chunk that has gone. The feed
 * compares this value and reloads outright when it changes, which is the only way back
 * from a page whose code is no longer on the server.
 */
const INSTANCE = randomUUID();

// The live feed asks this route "is there anything newer than what I was rendered with?".
// It stays deliberately small — one indexed row plus a count — because every open tab
// calls it on a timer, and the answer is normally "no".
export async function GET() {
  return NextResponse.json({ ...(await feedPulse()), instance: INSTANCE }, { headers: { "cache-control": "no-store" } });
}
