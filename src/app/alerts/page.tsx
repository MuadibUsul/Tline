import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { noIndex } from "@/lib/seo";

export default function AlertsPage() {
  redirect("/watchlist");
}

// Behind a sign-in: robots.txt asks a crawler not to fetch this, which does not keep
// it out of an index if something links to it. This does.
export const metadata: Metadata = { title: "Alerts", ...noIndex };
