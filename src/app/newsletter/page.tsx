import type { Metadata } from "next";
import { getLocale, tr } from "@/lib/i18n";
import { noIndex } from "@/lib/seo";
import { subscribeAction } from "./actions";

export const dynamic = "force-dynamic";

// A thin form page whose only job is to hand someone to their inbox. It earns no index
// entry of its own; what it offers is reachable from every page that carries the form.
export const metadata: Metadata = { title: "Newsletter", ...noIndex };

/**
 * The four outcomes the page can be landed on, all of them one short sentence: the visitor
 * arrived here from a redirect and needs to know what just happened, not why.
 */
const STATUS_COPY: Record<string, { tone: string; en: string; zh: string }> = {
  pending: {
    tone: "chip acc",
    en: "Almost there: check your inbox and click the confirmation link.",
    zh: "还差一步:请查收邮箱并点击确认链接。",
  },
  confirmed: {
    tone: "chip bull",
    en: "Subscription confirmed. See you next week.",
    zh: "订阅已确认,下周见。",
  },
  unsubscribed: {
    tone: "chip gray",
    en: "Unsubscribed. No newsletters will be sent to that address.",
    zh: "已退订,不会再向该地址发送通讯。",
  },
  invalid: {
    tone: "chip bear",
    en: "That link is invalid or has expired. You can subscribe again below.",
    zh: "链接无效或已过期,可在下方重新订阅。",
  },
};

export default async function NewsletterPage(props: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const status = STATUS_COPY[searchParams.status ?? ""];

  return (
    <main className="wrap" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "Newsletter", "每周通讯")}</div>
        <h1>{tr(locale, "The week in institutional research", "每周机构研报精选")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {tr(
            locale,
            "One email a week, bilingual, a short read: the institutional research worth your attention, each item linked to the source report. Unsubscribe any time; nothing else is ever sent.",
            "每周一封、中英双语、精炼易读:当周值得关注的机构研报,每条都附原始报告链接。随时可退订,除此之外不会有任何邮件。",
          )}
        </p>
      </div>

      {status && (
        <p className={status.tone} style={{ marginTop: 18, whiteSpace: "normal" }} role="status">
          {tr(locale, status.en, status.zh)}
        </p>
      )}

      <section className="blk" aria-label={tr(locale, "Subscribe", "订阅")}>
        <form action={subscribeAction} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="source" value="newsletter" />
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            aria-label={tr(locale, "Email address", "邮箱地址")}
            style={{ flex: "1 1 260px" }}
          />
          <button type="submit" className="minibtn p" style={{ padding: "9px 16px" }}>{tr(locale, "Subscribe", "订阅")}</button>
        </form>
        <p className="sub" style={{ margin: "10px 0 0", color: "var(--faint)" }}>
          {tr(
            locale,
            "Double opt-in: we email a confirmation link first, and nothing is sent before you click it. Every issue carries a one-click unsubscribe.",
            "双重确认:我们会先发送确认链接,点击之前不会发送任何内容。每期邮件都带一键退订。",
          )}
        </p>
      </section>

      <section className="blk" aria-label={tr(locale, "What you get", "你会收到什么")}>
        <div className="eyebrow">{tr(locale, "What you get", "你会收到什么")}</div>
        <p className="sub" style={{ marginTop: 10, color: "var(--muted)", lineHeight: 1.9 }}>
          <b>{tr(locale, "Bilingual.", "双语。")}</b>{" "}
          {tr(locale, "Every issue is written in English and Chinese; you receive the version you choose here.", "每期都有中、英文两个版本;你收到的是在这里选择的那一版。")}
          <br />
          <b>{tr(locale, "Weekly selection.", "每周精选。")}</b>{" "}
          {tr(locale, "Not everything we publish — the few reports that mattered that week, each linked to its source.", "不是全部发布内容,而是当周真正值得一读的少数研报,每条都附原始来源。")}
          <br />
          <b>{tr(locale, "Unsubscribe any time.", "随时退订。")}</b>{" "}
          {tr(locale, "One click, in every email, no questions asked.", "每封邮件里一键退订,无需任何理由。")}
          <br />
          <b>{tr(locale, "No spam.", "不发垃圾。")}</b>{" "}
          {tr(locale, "Your address is used for this one newsletter and nothing else.", "你的邮箱只用于这一份通讯,不作其他用途。")}
        </p>
      </section>
    </main>
  );
}
