"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { setPassword, type PasswordFormState } from "./actions";

export default function PasswordForm({
  hasPassword,
  labels,
}: {
  hasPassword: boolean;
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<PasswordFormState, FormData>(setPassword, {});

  if (state.done) {
    return (
      <div className="apikey-issued" role="status">
        <b>{labels.done}</b>
        <small>{state.signedOut ? labels.doneHint : labels.doneKeep}</small>
        {state.signedOut ? (
          // Changing a password ended this session too, so the only honest next step is
          // to sign in again with the new one.
          <button type="button" className="minibtn p" onClick={() => void signOut({ callbackUrl: "/signin" })}>
            {labels.signIn}
          </button>
        ) : (
          <Link className="minibtn p" href="/">{labels.continue}</Link>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="apikey-form">
      {hasPassword && (
        <label>
          <span>{labels.current}</span>
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
      )}
      <label>
        <span>{labels.next}</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <label>
        <span>{labels.confirm}</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <button className="minibtn p" type="submit" disabled={pending}>
        {pending ? labels.saving : hasPassword ? labels.change : labels.create}
      </button>
      {state.error && <p className="apikey-error" role="alert">{labels[state.error] ?? labels.unauthorised}</p>}
    </form>
  );
}
