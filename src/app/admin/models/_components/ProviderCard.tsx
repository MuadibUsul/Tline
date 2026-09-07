"use client";

import { useActionState } from "react";
import { saveProvider, testProvider, type ActionResult } from "../actions";

export interface ProviderCardLabels {
  apiKey: string;
  apiKeyPlaceholder: string;
  keyInForce: string;
  fromEnvironment: string;
  fromConsole: string;
  noKey: string;
  clearKey: string;
  baseUrl: string;
  baseUrlHint: string;
  defaultModel: string;
  defaultModelHint: string;
  enabled: string;
  save: string;
  saving: string;
  test: string;
  testing: string;
  lastCheck: string;
}

export interface ProviderCardProps {
  provider: string;
  title: string;
  /** Last four characters of the stored key, never the key. Null when none is stored. */
  hint: string | null;
  keySource: "console" | "environment" | "none";
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  lastCheck: string | null;
  labels: ProviderCardLabels;
}

/**
 * One provider's credentials.
 *
 * The key field is always empty on render: there is nothing to prefill it with, because
 * the server never sends the stored value to the browser. Leaving it blank keeps whatever
 * is stored, so editing the base URL cannot silently erase a key.
 */
export default function ProviderCard(props: ProviderCardProps) {
  const { labels } = props;
  const [saveState, save, saving] = useActionState<ActionResult, FormData>(saveProvider, {});
  const [testState, test, testing] = useActionState<ActionResult, FormData>(testProvider, {});

  const source = props.keySource === "console"
    ? labels.fromConsole
    : props.keySource === "environment"
      ? labels.fromEnvironment
      : labels.noKey;

  return (
    <section className="blk llm-provider">
      <div className="section-t">
        <span>{props.title}</span>
        <span className={`chip ${props.keySource === "none" ? "gray" : "acc"}`}>
          {source}{props.hint ? ` ${props.hint}` : ""}
        </span>
      </div>

      <form action={save} className="llm-form">
        <input type="hidden" name="provider" value={props.provider} />
        <label>
          <span>{labels.apiKey}</span>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={props.hint ? `${labels.keyInForce} ${props.hint}` : labels.apiKeyPlaceholder}
          />
        </label>
        <label>
          <span>{labels.baseUrl}</span>
          <input name="baseUrl" defaultValue={props.baseUrl ?? ""} placeholder={labels.baseUrlHint} spellCheck={false} />
        </label>
        <label>
          <span>{labels.defaultModel}</span>
          <input name="defaultModel" defaultValue={props.defaultModel ?? ""} placeholder={labels.defaultModelHint} spellCheck={false} />
        </label>
        <div className="llm-form-row">
          <label className="llm-check">
            <input type="checkbox" name="enabled" defaultChecked={props.enabled} />
            <span>{labels.enabled}</span>
          </label>
          {props.hint && (
            <label className="llm-check">
              <input type="checkbox" name="clearKey" />
              <span>{labels.clearKey}</span>
            </label>
          )}
        </div>
        <div className="llm-form-row">
          <button className="minibtn p" type="submit" disabled={saving}>{saving ? labels.saving : labels.save}</button>
          {saveState.error && <span className="llm-msg bad" role="alert">{saveState.error}</span>}
          {saveState.ok && <span className="llm-msg good" role="status">{saveState.ok}</span>}
        </div>
      </form>

      <form action={test} className="llm-form-row llm-test">
        <input type="hidden" name="provider" value={props.provider} />
        <button className="minibtn" type="submit" disabled={testing}>{testing ? labels.testing : labels.test}</button>
        {testState.error && <span className="llm-msg bad" role="alert">{testState.error}</span>}
        {testState.ok && <span className="llm-msg good" role="status">{testState.ok}</span>}
        {!testState.error && !testState.ok && props.lastCheck && (
          <span className="llm-msg muted">{labels.lastCheck} {props.lastCheck}</span>
        )}
      </form>
    </section>
  );
}
