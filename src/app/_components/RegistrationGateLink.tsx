"use client";

import Link from "next/link";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import RegistrationGate, { type GateReason } from "./RegistrationGate";

/**
 * For account-only destinations. Signed-out readers get the gate first; signed-in readers
 * keep the ordinary link. When the experiment is switched off, the original sign-in link
 * remains the fallback.
 */
export default function RegistrationGateLink({
  href,
  signedIn,
  locale,
  next,
  reason,
  className,
  children,
  gateEnabled = true,
}: {
  href: string;
  signedIn: boolean;
  locale: Locale;
  next: string;
  reason: GateReason;
  className?: string;
  children: React.ReactNode;
  gateEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (signedIn) return <Link href={href} className={className}>{children}</Link>;
  if (!gateEnabled) return <Link href={`/signin?next=${encodeURIComponent(next)}`} className={className}>{children}</Link>;
  return (
    <>
      <Link
        href={`/signin?next=${encodeURIComponent(next)}`}
        className={className}
        aria-haspopup="dialog"
        onClick={(event) => { event.preventDefault(); setOpen(true); }}
      >
        {children}
      </Link>
      <RegistrationGate open={open} onClose={() => setOpen(false)} locale={locale} reason={reason} next={next} />
    </>
  );
}
