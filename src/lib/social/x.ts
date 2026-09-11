import { prisma } from "../db";
import { decryptSecret, encryptSecret } from "../secrets";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";

export class UncertainPublishError extends Error {
  constructor(message: string) { super(message); this.name = "UncertainPublishError"; }
}

export async function xAppCredentials() {
  const stored = await prisma.socialPlatformCredential.findUnique({ where: { platform: "x" } });
  const clientId = stored?.clientId || process.env.X_CLIENT_ID;
  if (!clientId) throw new Error("X_CLIENT_ID is required.");
  return { clientId, clientSecret: decryptSecret(stored?.clientSecretCipher) || process.env.X_CLIENT_SECRET || null };
}

async function tokenRequest(params: URLSearchParams) {
  const { clientId, clientSecret } = await xAppCredentials();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  else params.set("client_id", clientId);
  const response = await fetch(TOKEN_URL, { method: "POST", headers, body: params, signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(`X OAuth failed: ${body.error_description || response.status}`);
  return body;
}

export async function exchangeXCode(code: string, verifier: string, redirectUri: string) {
  return tokenRequest(new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: verifier }));
}

async function refresh(account: { id: string; refreshTokenCipher: string | null }) {
  const refreshToken = decryptSecret(account.refreshTokenCipher);
  if (!refreshToken) throw new Error("X refresh token is missing or unreadable; reconnect the account.");
  const result = await tokenRequest(new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token" }));
  await prisma.socialAccount.update({ where: { id: account.id }, data: {
    accessTokenCipher: encryptSecret(result.access_token!),
    ...(result.refresh_token ? { refreshTokenCipher: encryptSecret(result.refresh_token) } : {}),
    tokenExpiresAt: new Date(Date.now() + (result.expires_in || 7200) * 1000), lastError: null,
  } });
  return result.access_token!;
}

async function accessToken(accountId: string) {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!account || account.platform !== "x" || !account.enabled) throw new Error("X account is unavailable.");
  if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() < Date.now() + 60_000) return refresh(account);
  const token = decryptSecret(account.accessTokenCipher);
  if (!token) return refresh(account);
  return token;
}

async function xFetch(accountId: string, path: string, init: RequestInit, retry = true): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`https://api.x.com${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await accessToken(accountId)}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new UncertainPublishError(`X request result is unknown; verify the account before retrying. ${String(error)}`);
  }
  if (response.status === 401 && retry) {
    await prisma.socialAccount.update({ where: { id: accountId }, data: { tokenExpiresAt: new Date(0) } });
    return xFetch(accountId, path, init, false);
  }
  return response;
}

export async function xIdentity(accessToken: string) {
  const response = await fetch("https://api.x.com/2/users/me", { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const body = await response.json() as { data?: { id: string; username: string }; detail?: string };
  if (!response.ok || !body.data) throw new Error(`X identity failed: ${body.detail || response.status}`);
  return body.data;
}

export async function createXPost(accountId: string, text: string, replyTo?: string): Promise<string> {
  const response = await xFetch(accountId, "/2/tweets", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) }),
  });
  if (response.status >= 500) throw new UncertainPublishError(`X returned HTTP ${response.status}; verify the account before retrying.`);
  const body = await response.json() as { data?: { id: string }; detail?: string; errors?: Array<{ detail?: string; message?: string }> };
  if (!response.ok || !body.data?.id) throw new Error(`X publish failed: ${body.detail || body.errors?.[0]?.detail || body.errors?.[0]?.message || response.status}`);
  return body.data.id;
}
