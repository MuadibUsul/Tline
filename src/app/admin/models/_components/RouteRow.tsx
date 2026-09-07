"use client";

import { useActionState } from "react";
import { saveRoute, type ActionResult } from "../actions";

export interface RouteRowLabels {
  auto: string;
  providerDefault: string;
  enabled: string;
  save: string;
  saving: string;
}

/**
 * One task's routing.
 *
 * Provider and model are separate on purpose: choosing a vendor and choosing which of its
 * models to spend on are different decisions, and the cheap-model-for-bulk-work pattern
 * needs the second one without changing the first.
 */
export default function RouteRow({
  task,
  title,
  hint,
  provider,
  model,
  enabled,
  providers,
  labels,
}: {
  task: string;
  title: string;
  hint: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  providers: string[];
  labels: RouteRowLabels;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveRoute, {});

  return (
    <form action={action} className="llm-route">
      <input type="hidden" name="task" value={task} />
      <div className="llm-route-name">
        <b>{title}</b>
        <small>{hint}</small>
      </div>
      <select name="provider" defaultValue={provider ?? ""} aria-label={title}>
        <option value="">{labels.auto}</option>
        {providers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <input name="model" defaultValue={model ?? ""} placeholder={labels.providerDefault} spellCheck={false} />
      <label className="llm-check">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        <span>{labels.enabled}</span>
      </label>
      <button className="minibtn" type="submit" disabled={pending}>{pending ? labels.saving : labels.save}</button>
      {state.error && <span className="llm-msg bad" role="alert">{state.error}</span>}
      {state.ok && <span className="llm-msg good" role="status">{state.ok}</span>}
    </form>
  );
}
