import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { encryptSecret } from "@/lib/secrets";
import { siteUrl } from "@/lib/site";
import { exchangeXCode, xIdentity } from "@/lib/social/x";
import { writeAudit } from "@/lib/audit";

function readCookie(value: string | undefined): { accountId: string; state: string; verifier: string } | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me").update(payload).digest("base64url");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  const claim = readCookie(request.cookies.get("social_x_oauth")?.value);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const target = new URL("/admin/social", siteUrl());
  if (!user || !can(user, "admin.social") || !claim || !code || state !== claim.state) {
    target.searchParams.set("error", "oauth_state");
    return NextResponse.redirect(target);
  }
  try {
    const tokens = await exchangeXCode(code, claim.verifier, `${siteUrl()}/api/social/x/callback`);
    const identity = await xIdentity(tokens.access_token!);
    await prisma.socialAccount.update({ where: { id: claim.accountId }, data: {
      externalAccountId: identity.id, externalUsername: identity.username,
      accessTokenCipher: encryptSecret(tokens.access_token!),
      refreshTokenCipher: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in || 7200) * 1000), enabled: true, lastError: null,
    } });
    await writeAudit({ actorId: user.id, action: "social.account.connect", targetType: "socialAccount", targetId: claim.accountId, metadata: { username: identity.username } });
    target.searchParams.set("connected", identity.username);
  } catch (error) {
    await prisma.socialAccount.updateMany({ where: { id: claim.accountId }, data: { enabled: false, lastError: String(error).slice(0, 500) } });
    target.searchParams.set("error", "oauth_exchange");
  }
  const response = NextResponse.redirect(target);
  response.cookies.delete("social_x_oauth");
  return response;
}
