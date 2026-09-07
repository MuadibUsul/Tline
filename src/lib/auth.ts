import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { getServerSession } from "next-auth";
import { authOptions, isDemoAuthAllowed, isFormalAuthConfigured, isPasswordAuthConfigured } from "./auth-config";

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

/** How long a `lastSeenAt` reading stays good enough, so reads do not cause a write. */
const SEEN_INTERVAL_MS = 10 * 60_000;

type SessionUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

/**
 * A suspended account is not a user.
 *
 * Returning null here rather than checking at each call site means suspension takes
 * effect everywhere at once — pages, server actions and API routes alike — and an
 * operator does not have to trust that every future feature remembered to ask.
 */
function activeUser(user: SessionUser | null): SessionUser | null {
  if (!user || user.suspendedAt) return null;
  touch(user);
  return user;
}

/** Records activity in the background; a failed or skipped write costs nothing. */
function touch(user: SessionUser) {
  if (user.lastSeenAt && Date.now() - user.lastSeenAt.getTime() < SEEN_INTERVAL_MS) return;
  void prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
}

/** Current user from the session cookie, or null. Safe to call in RSC + actions. */
export async function getSessionUser() {
  // Gated on formal auth alone, this ignored a perfectly valid NextAuth session whenever
  // AUTH_PROVIDER was unset — so signing in with a password succeeded, set its cookie, and
  // every page still rendered as signed out. Password sign-in issues a NextAuth session
  // too, so the question is whether any NextAuth provider is registered, not whether the
  // mail provider happens to be one of them.
  if (isFormalAuthConfigured() || isPasswordAuthConfigured()) {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: session.user.email } });
      if (!user) return null;
      // A token minted before the password last changed belongs to a session the owner has
      // since revoked by changing it.
      const issuedAt = (session as { issuedAt?: number }).issuedAt;
      if (user.passwordChangedAt && (!issuedAt || issuedAt < user.passwordChangedAt.getTime())) return null;
      return activeUser(user);
    }
    // No NextAuth session. The preview cookie below is only consulted where the preview
    // identity is still offered, so a deployment that has moved to real accounts cannot be
    // entered with a cookie minted back when it had none.
    if (!isDemoAuthAllowed()) return null;
  }
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const claim = readToken(raw);
  if (!claim) return null;
  return activeUser(await prisma.user.findUnique({ where: { id: claim.uid } }));
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
  secure: process.env.NODE_ENV === "production",
};
