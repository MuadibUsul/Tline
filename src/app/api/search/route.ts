import { NextResponse } from "next/server";
import { searchSite } from "@/lib/search";
import { resolveLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale") ?? undefined);
  if (query.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await searchSite(query, 12, locale) });
}
