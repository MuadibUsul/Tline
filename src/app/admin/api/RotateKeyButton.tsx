"use client";

import { useActionState, useState } from "react";
import { rotateApiKey, type CreateKeyResult } from "../actions";

/**
 * Rotates one key and shows the replacement secret once, in place.
 *
 * Same rule as issuing: the secret comes back through the action result, never through a
 * redirect, so it does not land in a URL, browser history, referrer header or server log.
 */
export default function RotateKeyButton({
  id,
  labels,
}: {
  id: string;
  labels: { rotate: string; rotating: string; confirm: string; issued: string; warning: string; copy: string; copied: string };
}) {
  const [state, submit, pending] = useActionState<CreateKeyResult, FormData>(rotateApiKey, {});
  const [copied, setCopied] = useState(false);

  return (
    <>
      <form
        action={submit}
        onSubmit={(event) => { if (!window.confirm(labels.confirm)) event.preventDefault(); }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="minibtn" type="submit" disabled={pending}>{pending ? labels.rotating : labels.rotate}</button>
      </form>
      {state.error && <p className="admin-form-msg bear">{state.error}</p>}
      {state.token && (
        <div className="apikey-issued" role="status">
          <div className="apikey-issued-head">
            <b>{labels.issued}</b>
            <button
              className="minibtn"
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(state.token!).then(() => setCopied(true)); }}
            >
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
          <code className="apikey-secret">{state.token}</code>
          <p>{labels.warning}</p>
        </div>
      )}
    </>
  );
}
