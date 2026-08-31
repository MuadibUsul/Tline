import Link from "next/link";
import { getLocale, tr } from "@/lib/i18n";

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <main className="wrap system-state">
      <div className="eyebrow">404</div>
      <h1>{tr(locale, "Nothing is stored at this address.", "此地址没有可用内容。")}</h1>
      <p>{tr(locale, "The research item may not exist or may no longer be available to this account.", "该研报可能不存在，或此账户已无法访问。")}</p>
      <Link className="minibtn p" href="/research">{tr(locale, "Browse research", "浏览研报")}</Link>
    </main>
  );
}
