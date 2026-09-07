"use client";

import { useActionState } from "react";
import { savePrice, type ActionResult } from "../actions";

export interface PriceFormLabels {
  provider: string;
  model: string;
  modelPlaceholder: string;
  inputPrice: string;
  outputPrice: string;
  currency: string;
  save: string;
  saving: string;
}

/**
 * Prices are entered rather than shipped.
 *
 * Published rates change and differ by account, so a number hard-coded here would be
 * reported to the operator as fact while being wrong. Until a model is priced the console
 * shows its tokens and says the cost is unknown, which is true.
 */
export default function PriceForm({
  providers,
  suggestions,
  labels,
}: {
  providers: string[];
  /** Models already seen in the usage window, so the common case is one click. */
  suggestions: { provider: string; model: string }[];
  labels: PriceFormLabels;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(savePrice, {});

  return (
    <form action={action} className="llm-price-form">
      <label>
        <span>{labels.provider}</span>
        <select name="provider" defaultValue={suggestions[0]?.provider ?? providers[0]}>
          {providers.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label>
        <span>{labels.model}</span>
        <input name="model" list="llm-model-suggestions" defaultValue={suggestions[0]?.model ?? ""} placeholder={labels.modelPlaceholder} spellCheck={false} required />
        <datalist id="llm-model-suggestions">
          {suggestions.map((row) => <option key={`${row.provider}/${row.model}`} value={row.model} />)}
        </datalist>
      </label>
      <label>
        <span>{labels.inputPrice}</span>
        <input name="inputPerMTok" type="number" step="0.0001" min="0" required />
      </label>
      <label>
        <span>{labels.outputPrice}</span>
        <input name="outputPerMTok" type="number" step="0.0001" min="0" required />
      </label>
      <label>
        <span>{labels.currency}</span>
        <input name="currency" defaultValue="USD" maxLength={8} size={5} />
      </label>
      <button className="minibtn p" type="submit" disabled={pending}>{pending ? labels.saving : labels.save}</button>
      {state.error && <span className="llm-msg bad" role="alert">{state.error}</span>}
      {state.ok && <span className="llm-msg good" role="status">{state.ok}</span>}
    </form>
  );
}
