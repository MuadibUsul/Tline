"use client";

import { useActionState } from "react";
import type { UserActionResult } from "../actions";

type Action = (previous: UserActionResult, formData: FormData) => Promise<UserActionResult>;

/**
 * One form wrapper for every account mutation.
 *
 * Each of these actions can refuse — the last admin, a self-demotion, a mistyped
 * confirmation — and a refusal the operator never sees is worse than no button at all.
 * The result is rendered next to the control that caused it rather than as a toast that
 * has scrolled away by the time they look.
 */
export default function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  /** Browser confirmation for a step with no undo; the server still asks for its own proof. */
  confirm?: string;
}) {
  const [state, submit, pending] = useActionState<UserActionResult, FormData>(action, {});
  return (
    <form
      action={submit}
      className={className}
      onSubmit={confirm ? (event) => { if (!window.confirm(confirm)) event.preventDefault(); } : undefined}
    >
      <fieldset disabled={pending}>{children}</fieldset>
      {state.error && <p className="admin-form-msg bear">{state.error}</p>}
      {state.ok && <p className="admin-form-msg bull">{state.ok}</p>}
    </form>
  );
}
