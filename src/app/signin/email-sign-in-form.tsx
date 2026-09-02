"use client";

import { type FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export function EmailSignInForm({
  callbackUrl,
  emailLabel,
  placeholder,
  submitLabel,
  sendingLabel,
}: {
  callbackUrl: string;
  emailLabel: string;
  placeholder: string;
  submitLabel: string;
  sendingLabel: string;
}) {
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    const data = new FormData(event.currentTarget);
    await signIn("email", { email: String(data.get("email") || ""), callbackUrl });
    setSending(false);
  }

  return <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <label className="field">
      <span>{emailLabel}</span>
      <input name="email" type="email" autoComplete="email" required placeholder={placeholder} />
    </label>
    <button disabled={sending} type="submit" className="minibtn p" style={{ padding: "9px 14px", justifyContent: "center" }}>
      {sending ? sendingLabel : submitLabel} →
    </button>
  </form>;
}
