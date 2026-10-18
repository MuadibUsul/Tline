import { tr, type Locale } from "@/lib/i18n";
import { subscribeAction } from "../newsletter/actions";

/**
 * The compact subscribe block for the foot of a page.
 *
 * Server-rendered and stateless: the form posts to the shared server action, so the
 * component adds no client JavaScript of its own and can sit at the end of any page.
 * `source` is the only thing that distinguishes one placement from another — it is what
 * a row's history records as "home" versus "article".
 */
export default function NewsletterCTA({ locale, source, variant = "default" }: { locale: Locale; source: string; variant?: "default" | "column" }) {
  if (variant === "column") {
    return (
      <section className="blk newsletter-column" aria-label={tr(locale, "Newsletter", "每周通讯")}>
        <div className="section-t">{tr(locale, "Newsletter", "每周通讯")}</div>
        <p className="sub newsletter-column-intro">
          {tr(locale, "One email a week: the institutional research worth reading, in your language.", "每周一封:值得一读的机构研报精选,中英双语。")}
        </p>
        <form action={subscribeAction} className="newsletter-column-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="source" value={source} />
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            aria-label={tr(locale, "Email address", "邮箱地址")}
          />
          <button type="submit" className="minibtn p">{tr(locale, "Subscribe", "订阅")}</button>
        </form>
        <p className="sub newsletter-column-fine">
          {tr(locale, "Double opt-in. Unsubscribe in one click; we never share your address.", "双重确认订阅,一键退订,不共享你的邮箱。")}
        </p>
      </section>
    );
  }
  return (
    <section className="blk" aria-label={tr(locale, "Newsletter", "每周通讯")}>
      <div className="rowlist">
        <div className="r newsletter-row">
          <span className="newsletter-copy">
            <span className="eyebrow">{tr(locale, "Newsletter", "每周通讯")}</span>
            <span className="sub">
              {tr(locale, "One email a week: the institutional research worth reading, in your language.", "每周一封:值得一读的机构研报精选,中英双语。")}
            </span>
          </span>
          <form action={subscribeAction} className="newsletter-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="source" value={source} />
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
              aria-label={tr(locale, "Email address", "邮箱地址")}
            />
            <button type="submit" className="minibtn p">{tr(locale, "Subscribe", "订阅")}</button>
          </form>
        </div>
        <div className="r">
          <span className="sub newsletter-fine">
            {tr(locale, "Double opt-in. Unsubscribe in one click; we never share your address.", "双重确认订阅,一键退订,不共享你的邮箱。")}
          </span>
        </div>
      </div>
    </section>
  );
}
