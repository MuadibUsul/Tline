import { doSignIn } from "@/app/actions";
import type { Metadata } from "next";
import { noIndex } from "@/lib/seo";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DEMO_EMAIL } from "@/lib/user";
import { formalAuthLabel, isEmailAuthConfigured, isFormalAuthConfigured, isPasswordAuthConfigured } from "@/lib/auth-config";
import { getLocale, tr, localePath } from "@/lib/i18n";
import { EmailSignInForm } from "./email-sign-in-form";
import { PasswordSignInForm } from "./password-sign-in-form";

export const dynamic = "force-dynamic";

// Behind a sign-in: robots.txt asks a crawler not to fetch this, which does not keep
// it out of an index if something links to it. This does.
export const metadata: Metadata = { title: "Sign in", ...noIndex };


export default async function SignInPage(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const locale = await getLocale();
  const next = searchParams.next?.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/watchlist";
  const user = await getSessionUser();
  if (user) redirect(next);
  const formalAuth = isFormalAuthConfigured();
  const emailAuth = isEmailAuthConfigured();
  // Password sign-in no longer depends on the mail provider. When SMTP is down, everyone
  // who already has a password must still be able to get in — losing both at once is how
  // an operator ends up locked out of their own console.
  const passwordAuth = isPasswordAuthConfigured();
  const demoAuthEnabled = !formalAuth && (process.env.NODE_ENV !== "production" || process.env.ALLOW_INSECURE_DEMO_AUTH === "true");

  return (
    <main className="wrap" style={{ maxWidth: 460 }}>
      <div className="page-head" style={{ borderBottom: "none" }}>
        <div className="eyebrow">{tr(locale, "Account", "账户")}</div>
        <h1>{tr(locale, "Sign in", "登录")}</h1>
        {/* Describes the form actually offered first. The preview identity can be enabled
            alongside a password in development, and describing that one instead told a
            visitor looking at a password field that no password was needed. */}
        <p className="sub" style={{ color: "var(--muted)" }}>{passwordAuth
          ? tr(locale, "Sign in with your email and password.", "使用邮箱和密码登录。")
          : demoAuthEnabled
            ? tr(locale, "Preview sign-in identifies your watchlist and alerts without a password.", "预览登录无需密码，用于识别你的关注列表和提醒。")
            : tr(locale, `Continue with ${formalAuthLabel()} to access your account.`, `使用 ${formalAuthLabel()} 继续访问账户。`)}</p>
      </div>

      {searchParams.error === "email" && (
        <p className="chip bear" style={{ display: "inline-block" }}>{tr(locale, "Enter a valid email.", "请输入有效的电子邮箱。")}</p>
      )}
      {searchParams.error === "disabled" && (
        <p className="chip bear" style={{ display: "inline-block" }}>{tr(locale, "Preview sign-in is disabled in production.", "生产环境已禁用预览登录。")}</p>
      )}

      {passwordAuth && <>
        <PasswordSignInForm
          callbackUrl={next}
          labels={{
            email: tr(locale, "Email", "电子邮箱"),
            password: tr(locale, "Password", "密码"),
            submit: tr(locale, "Sign in", "登录"),
            signingIn: tr(locale, "Signing in", "登录中"),
            failed: tr(locale, "That email and password do not match an account.", "邮箱与密码不匹配。"),
          }}
        />
        {/* Folded away on purpose: each use sends a message, and the quota for those is
            worth keeping for enrolling an account and recovering one. */}
        <details className="signin-recover">
          <summary>{tr(locale, "First time here, or forgotten your password?", "首次登录,或忘记密码?")}</summary>
          {emailAuth ? <>
            <p>{tr(
              locale,
              "We will email you a one-time link. Use it to sign in, then set a password so later sign-ins need no message.",
              "我们会发送一次性登录链接。用它登录后请设置密码,之后登录就不再需要收信。",
            )}</p>
            <EmailSignInForm
              callbackUrl="/account/password"
              emailLabel={tr(locale, "Email", "电子邮箱")}
              placeholder="you@example.com"
              submitLabel={tr(locale, "Email me a sign-in link", "发送登录链接")}
              sendingLabel={tr(locale, "Sending", "发送中")}
              labels={{
                failed: tr(locale, "The link could not be sent. The mail service rejected it or is unreachable.", "链接发送失败：邮件服务拒绝了请求或无法连接。"),
                sent: tr(locale, "Check your inbox. The link is valid for a short time.", "请查收邮箱，链接短时间内有效。"),
              }}
            />
          </> : (
            /* Said plainly rather than shown as a form that silently does nothing: an
               unconfigured mail service is an operator problem, and a visitor waiting for
               a message that was never sent has no way to discover that. */
            <p role="status">{tr(
              locale,
              "Email sign-in links are not available: this deployment has no mail service configured. Ask an operator to set a password for you (npm run user:password).",
              "当前部署未配置邮件服务，无法发送登录链接。请联系管理员为你设置密码（npm run user:password）。",
            )}</p>
          )}
        </details>
      </>}

      {formalAuth && !passwordAuth && <a className="minibtn p" style={{ display: "block", padding: "10px 14px", textAlign: "center" }} href={localePath(locale, `/api/auth/signin?callbackUrl=${encodeURIComponent(next)}`)}>{tr(locale, `Continue with ${formalAuthLabel()}`, `使用 ${formalAuthLabel()} 继续`)} →</a>}

      {demoAuthEnabled && <><form action={doSignIn} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input type="hidden" name="next" value={next} />
        <label className="field">
          <span>{tr(locale, "Email", "电子邮箱")}</span>
          <input name="email" type="email" required placeholder="you@fund.com" />
        </label>
        <label className="field">
          <span>{tr(locale, "Name (optional)", "姓名（可选）")}</span>
          <input name="name" type="text" placeholder="Jane Trader" />
        </label>
        <button type="submit" className="minibtn p" style={{ padding: "9px 14px", justifyContent: "center" }}>{tr(locale, "Continue", "继续")} →</button>
      </form>

      <form action={doSignIn} style={{ marginTop: 14, textAlign: "center" }}>
        <input type="hidden" name="email" value={DEMO_EMAIL} />
        <input type="hidden" name="name" value="Demo Trader" />
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="minibtn" style={{ padding: "8px 14px" }}>{tr(locale, "Continue as demo", "以演示用户继续")} →</button>
      </form></>}
    </main>
  );
}
