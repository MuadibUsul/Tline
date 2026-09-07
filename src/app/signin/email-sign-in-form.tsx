"use client";

import { type FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Requests a one-time sign-in link.
 *
 * The result is inspected rather than left to a redirect. Without `redirect: false`,
 * NextAuth navigates away on success and to its own error page on failure, so a mail
 * service that rejects the message leaves this button reading "Sending" for as long as the
 * visitor is willing to wait — the one state that tells them nothing. Whether the message
 * was accepted for delivery is the only thing this form can honestly report, so it reports
 * exactly that.
 */
export function EmailSignInForm({
  callbackUrl,
  emailLabel,
  placeholder,
  submitLabel,
  sendingLabel,
  labels,
}: {
  callbackUrl: string;
  emailLabel: string;
  placeholder: string;
  submitLabel: string;
  sendingLabel: string;
  labels: { failed: string; sent: string };
}) {
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<"sent" | "failed" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setOutcome(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await signIn("email", {
        email: String(data.get("email") || ""),
        callbackUrl,
        redirect: false,
      });
      setOutcome(result?.error ? "failed" : "sent");
    } catch {
      // A network failure or a server error before NextAuth could answer. Either way the
      // message did not go out, and saying so beats spinning forever.
      setOutcome("failed");
    } finally {
      setSending(false);
    }
  }

  return <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <label className="field">
      <span>{emailLabel}</span>
      <input name="email" type="email" autoComplete="email" required placeholder={placeholder} />
    </label>
    <button disabled={sending} type="submit" className="minibtn p" style={{ padding: "9px 14px", justifyContent: "center" }}>
      {sending ? sendingLabel : submitLabel} →
    </button>
    {outcome === "failed" && <p className="apikey-error" role="alert">{labels.failed}</p>}
    {outcome === "sent" && <p className="chip bull" role="status" style={{ display: "inline-block" }}>{labels.sent}</p>}
  </form>;
}
