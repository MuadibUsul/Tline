import { createHash, createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";

function sign(value: string) { return createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me").update(value).digest("base64url"); }

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.social")) return new NextResponse(null, { status: 404 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  const account = accountId ? await prisma.socialAccount.findUnique({ where: { id: accountId } }) : null;
  if (!account || account.platform !== "x") return NextResponse.redirect(`${siteUrl()}/admin/social?error=account`);
  const clientId = process.env.X_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${siteUrl()}/admin/social?error=x_config`);
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ accountId, state, verifier })).toString("base64url");
  const oauth = new URL("https://x.com/i/oauth2/authorize");
  oauth.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: `${siteUrl()}/api/social/x/callback`, scope: "tweet.read tweet.write users.read offline.access", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  const response = NextResponse.redirect(oauth);
  response.cookies.set("social_x_oauth", `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/social/x", maxAge: 600 });
  return response;
}
