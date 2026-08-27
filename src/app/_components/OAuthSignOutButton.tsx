"use client";

import { signOut } from "next-auth/react";

export default function OAuthSignOutButton({ label }: { label: string }) {
  return <button type="button" className="minibtn" onClick={() => signOut({ callbackUrl: "/" })}>{label}</button>;
}
