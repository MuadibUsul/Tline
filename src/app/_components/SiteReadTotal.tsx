import { unstable_cache } from "next/cache";
import { siteReadTotals } from "@/lib/analytics/news";

/**
 * Site-wide human read total, cached briefly so the footer does not hit the
 * database on every render. The count and its口径 live in analytics/news.ts;
 * this component only owns the display and the short cache (60s).
 *
 * The cache must be created inside the component, not at module scope: a
 * module-level unstable_cache() call breaks Next 15.5's client reference
 * collection and drops client components (e.g. BookmarkButton) from the
 * route manifests, which makes pages that use them fail at runtime with
 * "Could not find the module ... in the React Client Manifest".
 */
export default async function SiteReadTotal({ label }: { label: string }) {
  const getTotals = unstable_cache(() => siteReadTotals(), ["site-read-totals"], {
    revalidate: 60,
  });
  const totals = await getTotals();
  return <span>{label}: {totals.total.toLocaleString("en-US")}</span>;
}
