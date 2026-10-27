import { unstable_cache } from "next/cache";
import { siteReadTotals } from "@/lib/analytics/news";

/**
 * Site-wide human read total, cached briefly so the footer does not hit the
 * database on every render. The count and its口径 live in analytics/news.ts;
 * this component only owns the display and the short cache (60s).
 */
const getTotals = unstable_cache(() => siteReadTotals(), ["site-read-totals"], {
  revalidate: 60,
});

export default async function SiteReadTotal({ label }: { label: string }) {
  const totals = await getTotals();
  return <span>{label}: {totals.total.toLocaleString("en-US")}</span>;
}
