import { NextResponse } from "next/server";
import { searchSite } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await searchSite(query) });
}
