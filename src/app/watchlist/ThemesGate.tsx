import Link from "next/link";
import { localePath, tr, type Locale } from "@/lib/i18n";

/**
 * What an anonymous visitor sees instead of the themes desk.
 *
 * The page is gated because everything on it is assembled per reader — the themes they
 * follow, the alerts the desk would fire for them, the catalyst calendar around their
 * positions. A sign-in wall that says only "sign in" leaves a visitor with no reason to, so
 * this states what the screen holds and what an account is for, and nothing that is behind
 * the gate appears here.
 */
export default function ThemesGate({ locale }: { locale: Locale }) {
  const zh = locale === "zh-CN";
  const signIn = localePath(locale, "/signin?next=/watchlist");
  const bullets = zh
    ? [
        ["活跃主线与强度", "按机构覆盖面、重要性与新鲜度排序，给出每条主线的传导路径与失效条件。"],
        ["行情确认", "把叙事方向和资产实际走势并列，区分「逻辑在被验证」与「只是被讨论」。"],
        ["来源依据", "每条主线都能回到具体机构的观点原文，可自行核验。"],
        ["关注与提醒", "关注主线、资产或机构，并在数据或行情触发条件时收到提醒。"],
      ]
    : [
        ["Live themes and strength", "Ranked by institutional breadth, importance and freshness, each with its transmission path and the condition that invalidates it."],
        ["Market confirmation", "Narrative direction placed beside what the asset actually did — the difference between a thesis being confirmed and merely discussed."],
        ["Source evidence", "Every theme links back to the institution's own view, so nothing has to be taken on trust."],
        ["Following and alerts", "Follow themes, assets or institutions, and hear from the desk when data or prices meet a condition."],
      ];
  return (
    <main className="wrap">
      <header className="page-head">
        <div className="eyebrow">{tr(locale, "Account required", "需要账户")}</div>
        <h1>{tr(locale, "Market Themes", "交易主线")}</h1>
        <p className="sub">
          {tr(
            locale,
            "This desk is built per reader, so it opens for signed-in accounts. Registration is free and takes one email.",
            "这个工作台是按读者个人组装的，因此只对已登录账户开放。注册免费，只需一次邮箱确认。",
          )}
        </p>
      </header>

      <section className="blk" aria-labelledby="gate-what">
        <div className="section-t" id="gate-what">{tr(locale, "What is on this desk", "这个页面有什么")}</div>
        <ul className="citation-list">
          {bullets.map(([title, body]) => (
            <li key={title}>
              <b>{title}</b>
              <span style={{ color: "var(--muted)" }}> — {body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Get access", "获取访问权限")}</div>
        <p style={{ lineHeight: 1.7 }}>
          {tr(
            locale,
            "Enter your email, follow the one-time link we send, then set a password — after that sign-in needs no message. No tracking cookie is set and no IP address is stored.",
            "输入邮箱，点击我们发送的一次性链接，然后设置密码——此后登录不再需要邮件。我们不设置跟踪 Cookie，也不保存 IP 地址。",
          )}
        </p>
        <div className="act" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="minibtn p" href={signIn}>{tr(locale, "Register or sign in →", "注册或登录 →")}</Link>
          <Link className="minibtn" href={localePath(locale, "/methodology")}>{tr(locale, "How the themes are built", "主线是怎么生成的")}</Link>
        </div>
      </section>
    </main>
  );
}
