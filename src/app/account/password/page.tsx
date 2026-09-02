import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getLocale, tr } from "@/lib/i18n";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import PasswordForm from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin?next=/account/password");
  const locale = await getLocale();
  const hasPassword = Boolean(user.passwordHash);

  return (
    <main className="wrap" style={{ maxWidth: 460 }}>
      <div className="page-head" style={{ borderBottom: "none" }}>
        <div className="eyebrow">{tr(locale, "Account", "账户")}</div>
        <h1>{hasPassword ? tr(locale, "Change password", "修改密码") : tr(locale, "Set a password", "设置密码")}</h1>
        <p className="sub" style={{ color: "var(--muted)" }}>
          {hasPassword
            ? tr(locale, "Changing it signs out every other device.", "修改后,其他设备上的登录会全部失效。")
            : tr(
                locale,
                "Sign in with this password from now on. Email is kept for recovery, so day-to-day access does not depend on a message arriving.",
                "此后使用密码登录。邮件仅保留用于找回密码,日常登录不再依赖收信。",
              )}
        </p>
      </div>

      <PasswordForm
        hasPassword={hasPassword}
        labels={{
          current: tr(locale, "Current password", "当前密码"),
          next: tr(locale, `New password (at least ${PASSWORD_MIN_LENGTH} characters)`, `新密码(至少 ${PASSWORD_MIN_LENGTH} 位)`),
          confirm: tr(locale, "Confirm new password", "再次输入新密码"),
          create: tr(locale, "Set password", "设置密码"),
          change: tr(locale, "Change password", "修改密码"),
          saving: tr(locale, "Saving…", "保存中……"),
          done: tr(locale, "Password saved", "密码已保存"),
          doneHint: tr(locale, "Every session was signed out, including this one.", "所有登录会话已失效,包括当前这个。"),
          doneKeep: tr(locale, "Use it the next time you sign in.", "下次登录时使用该密码。"),
          continue: tr(locale, "Continue", "继续"),
          signIn: tr(locale, "Sign in again", "重新登录"),
          short: tr(locale, `Use at least ${PASSWORD_MIN_LENGTH} characters.`, `密码至少 ${PASSWORD_MIN_LENGTH} 位。`),
          long: tr(locale, "That is too long.", "密码过长。"),
          email: tr(locale, "Do not reuse your email address.", "不要使用邮箱地址作为密码。"),
          common: tr(locale, "That password is guessed first in every attack.", "该密码在攻击中会被最先尝试。"),
          mismatch: tr(locale, "The two entries do not match.", "两次输入不一致。"),
          "wrong-current": tr(locale, "Current password is incorrect.", "当前密码不正确。"),
          unauthorised: tr(locale, "Sign in first.", "请先登录。"),
        }}
      />
    </main>
  );
}
