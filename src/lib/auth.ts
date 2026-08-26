import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

// Lightweight signed-cookie session. No passwords — email identifies the user.
// MVP-grade: fine for a demo with no sensitive data; swap for Auth.js in production.

export const COOKIE = "ii_session";
const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function makeToken(user: { id: string; email: string }): string {
  const p = Buffer.from(JSON.stringify({ uid: user.id, email: user.email })).toString("base64url");
  return `${p}.${sign(p)}`;
}

function readToken(token: string): { uid: string; email: string } | null {
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expected = sign(p);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(p, "base64url").toString());
  } catch {
    return null;
  }
}

/** Current user from the session cookie, or null. Safe to call in RSC + actions. */
export async function getSessionUser() {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const claim = readToken(raw);
  if (!claim) return null;
  return prisma.user.findUnique({ where: { id: claim.uid } });
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
