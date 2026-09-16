import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./db";
import { writeAudit } from "./audit";
import { verifyPassword } from "./password";
import { rateLimit } from "./rateLimit";
import { notifyNewRegistration } from "./social/registrationNotice";
import { grantFoundingMembership } from "./membership";

export type AuthProviderId = "azure-ad" | "email" | "google";

function selectedProvider(): AuthProviderId | null {
  const value = process.env.AUTH_PROVIDER?.toLowerCase();
  return value === "azure-ad" || value === "email" || value === "google" ? value : null;
}

export function isFormalAuthConfigured() {
  const provider = selectedProvider();
  if (provider === "azure-ad") return Boolean(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET);
  if (provider === "email") return Boolean(process.env.EMAIL_SERVER && process.env.EMAIL_FROM);
  if (provider === "google") return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return false;
}

export function formalAuthLabel() {
  return selectedProvider() === "azure-ad" ? "Microsoft Entra ID" : selectedProvider() === "email" ? "Email" : selectedProvider() === "google" ? "Google" : "OAuth";
}

export function isEmailAuthConfigured() {
  return selectedProvider() === "email" && isFormalAuthConfigured();
}

/** Nodemailer must receive one ordinary mailbox, never an address list or comment syntax. */
export function normalizeEmailIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s<>()\[\],;:@]+@[^\s<>()\[\],;:@]+\.[^\s<>()\[\],;:@]+$/.test(value)) {
    throw new Error("Invalid email address.");
  }
  return value;
}

/**
 * Whether an account can sign in with a password.
 *
 * Password sign-in used to be registered only inside the `email` branch below, which tied
 * it to SMTP being configured: with EMAIL_SERVER missing or AUTH_PROVIDER unset there was
 * no `password` provider at all, every attempt failed, and the form reported it as
 * "that email and password do not match" — a configuration fault described to the user as
 * a wrong password, with no way to tell the two apart.
 *
 * A password is now independent of the mail provider. Only a deployment that has committed
 * to an external identity provider gives it up, because there the directory owns the
 * credential and a second one beside it is a second thing to attack.
 */
export function isPasswordAuthConfigured() {
  const provider = selectedProvider();
  const externalIdentity = (provider === "azure-ad" || provider === "google") && isFormalAuthConfigured();
  return !externalIdentity;
}

/**
 * Whether the passwordless preview identity is still accepted.
 *
 * Kept in one place because two things must agree about it: the sign-in page, which offers
 * it, and getSessionUser, which honours the cookie it issues. A deployment that has moved
 * to real accounts must not keep accepting a preview cookie minted before the move.
 */
export function isDemoAuthAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_INSECURE_DEMO_AUTH === "true";
}

function providers() {
  const provider = selectedProvider();
  if (provider === "azure-ad" && isFormalAuthConfigured()) {
    return [AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID || "common",
    })];
  }
  if (provider === "google" && isFormalAuthConfigured()) {
    return [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })];
  }
  const list = [];
  // Enrolment and recovery. Routine sign-in goes through the password provider, so the
  // mail provider's quota is not spent on getting in every day.
  if (isEmailAuthConfigured()) {
    list.push(EmailProvider({ server: process.env.EMAIL_SERVER!, from: process.env.EMAIL_FROM!, normalizeIdentifier: normalizeEmailIdentifier }));
  }
  // Unconditional: a broken or absent mail provider must not also remove the way in for
  // everyone who already has a password.
  list.push(passwordProvider());
  return list;
}

/**
 * Email and password.
 *
 * Attempts are throttled per address: scrypt already makes each guess expensive, and this
 * stops one account being hammered regardless. A wrong password and an unknown address
 * return the same answer, so the form cannot be used to discover who has an account.
 */
function passwordProvider() {
  return CredentialsProvider({
    id: "password",
    name: "Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password ?? "";
      if (!email || !password) return null;

      const { allowed } = rateLimit(`password:${email}`, PASSWORD_ATTEMPT_LIMIT, PASSWORD_ATTEMPT_WINDOW_MS);
      if (!allowed) return null;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || user.suspendedAt || !(await verifyPassword(password, user.passwordHash))) return null;
      return { id: user.id, email: user.email, name: user.name };
    },
  });
}

const PASSWORD_ATTEMPT_LIMIT = Math.max(1, Number(process.env.PASSWORD_ATTEMPT_LIMIT || 10));
const PASSWORD_ATTEMPT_WINDOW_MS = Math.max(60_000, Number(process.env.PASSWORD_ATTEMPT_WINDOW_MS || 15 * 60_000));

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  // JWT rather than database sessions: the credentials provider requires it. Revocation
  // comes back through passwordChangedAt below, so a password change still ends every
  // other session.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: providers(),
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const allowed = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(user.email.split("@").at(-1)!.toLowerCase())) return false;
      // A suspended account is refused at the door, whichever provider it arrives by:
      // otherwise an email link or OAuth round-trip would still mint a fresh token that
      // getSessionUser would then have to reject on every request.
      const record = await prisma.user.findUnique({ where: { email: user.email }, select: { suspendedAt: true } });
      return !record?.suspendedAt;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
        // Stamped at issue so a later password change can invalidate this token.
        token.issuedAt = Date.now();
        return token;
      }
      // Revocation is enforced here rather than at each call site, so a token minted
      // before the password changed is refused everywhere — including NextAuth's own
      // session endpoint — instead of only where the application happens to check.
      if (!token.email) return token;
      const owner = await prisma.user.findUnique({
        where: { email: token.email },
        select: { passwordChangedAt: true, suspendedAt: true },
      });
      if (owner?.suspendedAt) return {};
      if (owner?.passwordChangedAt && (!token.issuedAt || token.issuedAt < owner.passwordChangedAt.getTime())) {
        return {};
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = token.email;
      if (typeof token.issuedAt === "number") session.issuedAt = token.issuedAt;
      return session;
    },
  },
  events: {
    /**
     * Fired once when the adapter creates the account — the registration moment, and the
     * only one: an existing reader signing in never reaches it, so the notice cannot repeat.
     * The send is best-effort and never awaited into the sign-in path.
     */
    async createUser({ user }) {
      await writeAudit({ actorId: user.id, action: "auth.user_created", metadata: { email: user.email ?? null, provider: selectedProvider() } });
      // The first hundred registrations are founding members. Best-effort and never allowed
      // to fail the sign-up: a full house or a transient error must not block an account.
      const seat = await grantFoundingMembership(user.id).catch(() => null);
      if (user.email) void notifyNewRegistration({ email: user.email, name: user.name ?? null }, selectedProvider() ?? "oauth", new Date(), seat?.granted ? seat.seat : null);
    },
    async signIn({ user }) {
      await writeAudit({ actorId: user.id, action: "auth.oauth_sign_in", metadata: { provider: selectedProvider() } });
    },
    async signOut({ session }) {
      if ("userId" in session && typeof session.userId === "string") {
        await writeAudit({ actorId: session.userId, action: "auth.oauth_sign_out" });
      }
    },
  },
};
