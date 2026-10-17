import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

/**
 * Authentication for machine consumers of the public API.
 *
 * The secret is shown to an operator exactly once, at creation, and only its SHA-256
 * digest is stored: a leaked table cannot be replayed against the API. A plain digest is
 * the right primitive here rather than a password hash — the secret is 32 bytes of
 * entropy we generated, so there is no dictionary for an attacker to run.
 */

export const API_KEY_PREFIX = "tli";
const PREFIX_LENGTH = 8;

/**
 * `research:read` is the scope every endpoint that exists asks for.
 *
 * `consensus:read` is issued but unused: the three `/api/v1` routes all declare
 * `research:read`, and `/api/v1/consensus` is an empty directory where that endpoint was
 * planned. It stays in the list because a scope an operator has already issued must keep
 * parsing — dropping it here would silently strip the scope off existing keys and the
 * reason would not be visible anywhere. Wire it up when the endpoint ships, or delete both
 * lines then; until one of those happens this comment is the answer to "is it dead?".
 *
 * `mcp:user` and the two `publisher:*` scopes are the MCP scopes. `mcp:user` stays apart
 * from the publisher scopes on purpose: a key that can read the public corpus is not a key
 * that can write into the review queue, and issuing both to one key would erase the only
 * mechanical boundary between the two servers' audiences. The operator console refuses to
 * combine them, and the MCP routes additionally reject a key carrying both, so a
 * hand-edited row cannot get past either check.
 *
 * `publisher:draft` and `publisher:publish` may share a key — that is one publisher with
 * the full flow — but publish is a scope of its own (spec §12's `publisher:publish`) so it
 * can be granted, audited and revoked separately. A publisher key that drafts all day does
 * not gain the power to put anything on the public site until someone ticks that box.
 */
export type ApiScope = "research:read" | "consensus:read" | "mcp:user" | "publisher:draft" | "publisher:publish" | "admin:manage";
export const API_SCOPES: ApiScope[] = ["research:read", "consensus:read", "mcp:user", "publisher:draft", "publisher:publish", "admin:manage"];

/** The MCP scopes. `mcp:user` is mutually exclusive with every publisher scope. */
export const MCP_SCOPES: ApiScope[] = ["mcp:user", "publisher:draft", "publisher:publish", "admin:manage"];

/** The publisher-side MCP scopes, which may share a key with each other. */
export const PUBLISHER_SCOPES: ApiScope[] = ["publisher:draft", "publisher:publish"];

/**
 * True when a key can authenticate to at least one MCP server.
 *
 * Derived from MCP_SCOPES rather than a hand-kept subset: the console's MCP key table
 * used to check only `mcp:user` and `publisher:draft`, so a key issued with just
 * `publisher:publish` (a valid publish-only key) was invisible there while working on the
 * endpoint. Any scope added to MCP_SCOPES is now classified correctly with no other edit.
 */
export function hasMcpScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => MCP_SCOPES.includes(scope as ApiScope));
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** The visible half an operator recognises a key by; never enough to authenticate. */
export function tokenPrefix(token: string) {
  return token.slice(0, API_KEY_PREFIX.length + 1 + PREFIX_LENGTH);
}

export function generateToken() {
  return `${API_KEY_PREFIX}_${randomBytes(32).toString("base64url")}`;
}

export function parseScopes(value: string): ApiScope[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((scope): scope is ApiScope => API_SCOPES.includes(scope as ApiScope)) : [];
  } catch {
    return [];
  }
}

/** The account a key is bound to, as MCP authorization needs to re-check it per call. */
export interface KeyOwner {
  id: string;
  email: string;
  tier: string;
  role: string;
  suspendedAt: Date | null;
}

export interface AuthenticatedKey {
  id: string;
  name: string;
  scopes: ApiScope[];
  rateLimit: number;
  /**
   * Null for operator keys with no account row. The `/api/v1` routes never look at this;
   * MCP does, because a key whose owner was demoted or suspended must stop being honoured
   * on the next call rather than when someone remembers to revoke it.
   */
  owner: KeyOwner | null;
}

export type AuthFailure = "missing" | "malformed" | "unknown" | "revoked" | "forbidden" | "rate_limited";

/**
 * Requests per key per minute, counted in memory.
 *
 * The API runs as a single container, so a process-local window is the honest scope of
 * this limit: it is a courtesy throttle that stops a looping client from monopolising the
 * database, not a security control. Moving to more than one replica means moving this to
 * shared state.
 */
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

export function consumeRate(keyId: string, limit: number, now = Date.now()) {
  const current = hits.get(keyId);
  if (!current || current.resetAt <= now) {
    hits.set(keyId, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS };
  }
  current.count++;
  const remaining = limit - current.count;
  return { allowed: remaining >= 0, remaining: Math.max(0, remaining), resetAt: current.resetAt };
}

/** Only for tests: the window is process-local, so it needs an explicit reset. */
export function resetRateLimits() {
  hits.clear();
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * A refusal, and — where the caller was identified before being refused — which key it
 * was. A key exhausting its own rate limit is the failure an operator most needs
 * attributed; reporting it as "unauthenticated" points at nobody.
 */
export interface AuthRefusal {
  failure: AuthFailure;
  retryAfter?: number;
  keyId?: string;
}

export async function authenticate(
  header: string | null,
  required: ApiScope | ApiScope[],
): Promise<{ key: AuthenticatedKey; remaining: number; resetAt: number } | AuthRefusal> {
  const token = bearerToken(header);
  if (!token) return { failure: header ? "malformed" : "missing" };
  if (!token.startsWith(`${API_KEY_PREFIX}_`)) return { failure: "malformed" };

  const digest = hashToken(token);
  const record = await prisma.apiKey.findUnique({
    where: { tokenHash: digest },
    include: { createdBy: { select: { id: true, email: true, tier: true, role: true, suspendedAt: true } } },
  });
  if (!record) return { failure: "unknown" };
  // The lookup already matched on the digest; this compares it again in constant time so
  // the code does not depend on the database's comparison for a secret-dependent branch.
  if (!timingSafeEqual(Buffer.from(record.tokenHash), Buffer.from(digest))) return { failure: "unknown" };
  if (record.revokedAt) return { failure: "revoked", keyId: record.id };

  const scopes = parseScopes(record.scopes);
  // An array means "any of these": the publisher endpoint serves draft-scoped and
  // publish-scoped keys alike, and each tool then checks its own scope.
  const accepted = Array.isArray(required) ? required : [required];
  if (!scopes.some((scope) => accepted.includes(scope))) return { failure: "forbidden", keyId: record.id };

  const rate = consumeRate(record.id, record.rateLimit);
  if (!rate.allowed) return { failure: "rate_limited", retryAfter: Math.ceil((rate.resetAt - Date.now()) / 1000), keyId: record.id };

  // Usage is recorded without blocking the response; a lost counter increment costs
  // nothing, while a slow write on every request would be paid by the caller.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date(), requestCount: { increment: 1 } } })
    .catch(() => {});

  return {
    key: {
      id: record.id,
      name: record.name,
      scopes,
      rateLimit: record.rateLimit,
      owner: record.createdBy ? { ...record.createdBy } : null,
    },
    remaining: rate.remaining,
    resetAt: rate.resetAt,
  };
}
