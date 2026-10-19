"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import RegistrationGate, { type GateReason } from "./RegistrationGate";

/**
 * A submit button that becomes an account prompt only while signed out. The enclosing
 * form still posts to its existing server action; the server action's own permission check
 * remains the authority, so this is a convenience layer, not the security boundary.
 */
export default function RegistrationActionButton({
  signedIn,
  locale,
  next,
  reason,
  className,
  children,
  gateEnabled = true,
}: {
  signedIn: boolean;
  locale: Locale;
  next: string;
  reason: GateReason;
  className?: string;
  children: React.ReactNode;
  gateEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!signedIn && gateEnabled) {
    return (
      <>
        <button
          type="submit"
          className={className}
          aria-haspopup="dialog"
          onClick={(event) => { event.preventDefault(); setOpen(true); }}
        >
          {children}
        </button>
        <RegistrationGate open={open} onClose={() => setOpen(false)} locale={locale} reason={reason} next={next} />
      </>
    );
  }
  return <button type="submit" className={className}>{children}</button>;
}
