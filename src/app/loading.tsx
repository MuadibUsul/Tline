import { getLocale, tr } from "@/lib/i18n";

export default function Loading() {
  const locale = getLocale();
  return (
    <main className="wrap system-state" aria-live="polite" aria-busy="true">
      <div className="eyebrow">{tr(locale, "Loading", "加载中")}</div>
      <h1>{tr(locale, "Preparing institutional intelligence…", "正在准备机构情报……")}</h1>
      <p>{tr(locale, "Fetching the latest stored research and model outputs.", "正在获取最新入库研报和模型输出。")}</p>
    </main>
  );
}
