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

function providers() {
  const provider = selectedProvider();
  if (provider === "azure-ad" && isFormalAuthConfigured()) {
    return [AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID || "common",
    })];
  }
  if (provider === "email" && isFormalAuthConfigured()) {
    return [
      // Enrolment and recovery only. Routine sign-in goes through the password provider
      // below so the mail provider's quota is not spent on getting in every day.
      EmailProvider({
        server: process.env.EMAIL_SERVER!,
        from: process.env.EMAIL_FROM!,
      }),
      passwordProvider(),
    ];
  }
  if (provider === "google" && isFormalAuthConfigured()) {
    return [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })];
  }
  return [];
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
      if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
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
      return allowed.length === 0 || allowed.includes(user.email.split("@").at(-1)!.toLowerCase());
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
        select: { passwordChangedAt: true },
      });
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
