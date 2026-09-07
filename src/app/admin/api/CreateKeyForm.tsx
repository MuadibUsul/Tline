"use client";
import { useActionState, useState } from "react";
import { createApiKey, type CreateKeyResult } from "../actions";

/**
 * Issues a key and shows the secret once.
 *
 * The secret is returned through the action's own result rather than a redirect
 * parameter, so it never lands in a URL, browser history, referrer header or server log.
 * Once this component unmounts it is gone: only its digest was stored.
 */
export default function CreateKeyForm({
  scopes,
  labels,
}: {
  scopes: string[];
  labels: {
    name: string;
    namePlaceholder: string;
    scopes: string;
    rateLimit: string;
    submit: string;
    submitting: string;
    issued: string;
    warning: string;
    copy: string;
    copied: string;
  };
}) {
  const [state, action, pending] = useActionState<CreateKeyResult, FormData>(createApiKey, {});
  const [copied, setCopied] = useState(false);

  return (
    <>
      <form action={action} className="apikey-form">
        <label>
          <span>{labels.name}</span>
          <input name="name" required maxLength={80} placeholder={labels.namePlaceholder} />
        </label>
        <fieldset>
          <legend>{labels.scopes}</legend>
          {scopes.map((scope) => (
            <label key={scope} className="apikey-scope">
              <input type="checkbox" name="scopes" value={scope} defaultChecked />
              <code>{scope}</code>
            </label>
          ))}
        </fieldset>
        <label>
          <span>{labels.rateLimit}</span>
          <input name="rateLimit" type="number" min={1} max={6000} defaultValue={60} />
        </label>
        <button className="minibtn p" type="submit" disabled={pending}>
          {pending ? labels.submitting : labels.submit}
        </button>
        {state.error && <p className="apikey-error" role="alert">{state.error}</p>}
      </form>

      {state.token && (
        <div className="apikey-issued" role="status">
          <div className="apikey-issued-head">
            <b>{labels.issued}</b>
            <button
              type="button"
              className="minibtn"
              onClick={() => {
                void navigator.clipboard?.writeText(state.token!).then(() => setCopied(true));
              }}
            >
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
          <code className="apikey-secret">{state.token}</code>
          <small>{labels.warning}</small>
        </div>
      )}
    </>
  );
}
