"use client";

import { useActionState } from "react";
import { saveBudget, type ActionResult } from "../actions";

export interface BudgetRowLabels {
  day: string;
  month: string;
  tokenCap: string;
  costCap: string;
  noCap: string;
  enabled: string;
  save: string;
  saving: string;
  spent: string;
  paused: string;
}

/**
 * One scope's ceiling, with its current standing shown inline.
 *
 * Token and cost caps are separate fields because they answer different questions — "how
 * much work" versus "how much money" — and an operator often has a hard figure for only one
 * of them. Either, both, or neither may be set; leaving both blank clears the budget.
 */
export default function BudgetRow({
  scope,
  title,
  hint,
  period,
  limitTokens,
  limitCost,
  enabled,
  spentTokens,
  spentCost,
  currency,
  fraction,
  over,
  labels,
}: {
  scope: string;
  title: string;
  hint: string;
  period: "day" | "month";
  limitTokens: number | null;
  limitCost: number | null;
  enabled: boolean;
  spentTokens: number;
  spentCost: number | null;
  currency: string;
  fraction: number | null;
  over: boolean;
  labels: BudgetRowLabels;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveBudget, {});
  const pct = fraction === null ? null : Math.round(fraction * 100);
  const spentLabel = `${spentTokens.toLocaleString()} tok${spentCost === null ? "" : ` · ${currency} ${spentCost < 1 ? spentCost.toFixed(4) : spentCost.toFixed(2)}`}`;

  return (
    <form action={action} className={`llm-budget${over ? " over" : ""}`}>
      <input type="hidden" name="scope" value={scope} />
      <div className="llm-budget-name">
        <b>{title}</b>
        <small>{hint}</small>
        <small className="llm-budget-spent">
          {labels.spent}: {spentLabel}
          {pct !== null && <> · <b>{pct}%</b></>}
          {over && <span className="chip bad">{labels.paused}</span>}
        </small>
        {pct !== null && (
          <div className="llm-budget-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, pct)}%` }} className={over ? "over" : pct >= 80 ? "warn" : ""} />
          </div>
        )}
      </div>
      <select name="period" defaultValue={period} aria-label={title}>
        <option value="month">{labels.month}</option>
        <option value="day">{labels.day}</option>
      </select>
      <input name="limitTokens" defaultValue={limitTokens ?? ""} placeholder={labels.tokenCap} inputMode="numeric" spellCheck={false} />
      <input name="limitCost" defaultValue={limitCost ?? ""} placeholder={labels.costCap} inputMode="decimal" spellCheck={false} />
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
