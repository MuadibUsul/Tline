import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "./db";
import { writeAudit } from "./audit";

export type OAuthProviderId = "azure-ad" | "google";

function selectedProvider(): OAuthProviderId | null {
  const value = process.env.AUTH_PROVIDER?.toLowerCase();
  return value === "azure-ad" || value === "google" ? value : null;
}

export function isFormalAuthConfigured() {
  const provider = selectedProvider();
  if (provider === "azure-ad") return Boolean(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET);
  if (provider === "google") return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return false;
}

export function formalAuthLabel() {
  return selectedProvider() === "azure-ad" ? "Microsoft Entra ID" : selectedProvider() === "google" ? "Google" : "OAuth";
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
  return [];
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.AUTH_SECRET,
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
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
