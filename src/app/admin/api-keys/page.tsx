import { redirect } from "next/navigation";
import { getLocale, localePath } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// The keys screen grew into a whole API section. Bookmarks and links from earlier
// releases still point here, so the old address forwards rather than 404s.
export default async function LegacyApiKeysPage() {
  redirect(localePath(await getLocale(), "/admin/api"));
}
