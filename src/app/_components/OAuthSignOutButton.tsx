"use client";

import { signOut } from "next-auth/react";

export default function OAuthSignOutButton() {
  return <button type="button" className="minibtn" onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>;
}
