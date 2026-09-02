"use client";

import { type FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

/**
 * The everyday way in.
 *
 * The link-by-email route is kept behind a disclosure below: it is what enrols an account
 * and what recovers one, and every use of it spends the mail provider's quota, so it is
 * not the button offered first.
 */
export function PasswordSignInForm({
  callbackUrl,
  labels,
}: {
  callbackUrl: string;
  labels: { email: string; password: string; submit: string; signingIn: string; failed: string };
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    const data = new FormData(event.currentTarget);
    const result = await signIn("password", {
      email: String(data.get("email") || ""),
      password: String(data.get("password") || ""),
      redirect: false,
    });
    if (result?.ok) window.location.assign(callbackUrl);
    else {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label className="field">
        <span>{labels.email}</span>
        <input name="email" type="email" autoComplete="username" required placeholder="you@example.com" />
      </label>
      <label className="field">
        <span>{labels.password}</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button disabled={busy} type="submit" className="minibtn p" style={{ padding: "9px 14px", justifyContent: "center" }}>
        {busy ? labels.signingIn : labels.submit} →
      </button>
      {/* One message for a wrong password and for an unknown address alike: which of the
          two it was is not something a sign-in form should disclose. */}
      {failed && <p className="apikey-error" role="alert">{labels.failed}</p>}
    </form>
  );
}
