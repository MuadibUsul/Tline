"use client";

import { useActionState, useState } from "react";
import { createMyMcpKey, type McpKeyState } from "./actions";

/**
 * Issues one User MCP key and shows it once. The form is deliberately the only client
 * component on the page; the key list and documentation are server-rendered.
 */
export default function McpKeyForm({
  labels,
}: {
  labels: { name: string; placeholder: string; submit: string; submitting: string; issued: string; warning: string; copy: string; copied: string };
}) {
  const [state, action, pending] = useActionState<McpKeyState, FormData>(createMyMcpKey, {});
  const [copied, setCopied] = useState(false);

  return (
    <>
      <form action={action} className="news-form">
        <label className="news-field">
          <span>{labels.name}</span>
          <input name="name" maxLength={80} placeholder={labels.placeholder} />
        </label>
        <button className="minibtn p" type="submit" disabled={pending}>{pending ? labels.submitting : labels.submit}</button>
        {state.error ? <p className="apikey-error" role="alert">{state.error}</p> : null}
      </form>
      {state.token ? (
        <div className="apikey-issued" role="status">
          <div className="apikey-issued-head">
            <b>{labels.issued}</b>
            <button
              type="button"
              className="minibtn"
              onClick={() => {
                void navigator.clipboard?.writeText(state.token!).then(() => setCopied(true)).catch(() => setCopied(false));
              }}
            >
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
          <code className="apikey-secret">{state.token}</code>
          <small>{labels.warning}</small>
        </div>
      ) : null}
    </>
  );
}
