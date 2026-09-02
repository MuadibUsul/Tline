import { NextResponse } from "next/server";
import { feedPulse } from "@/lib/queries";

export const dynamic = "force-dynamic";

// The live feed asks this route "is there anything newer than what I was rendered with?".
// It stays deliberately small — one indexed row plus a count — because every open tab
// calls it on a timer, and the answer is normally "no".
export async function GET() {
  return NextResponse.json(await feedPulse(), { headers: { "cache-control": "no-store" } });
}
