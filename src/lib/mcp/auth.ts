import { authenticate, MCP_SCOPES, PUBLISHER_SCOPES, type ApiScope, type AuthFailure, type AuthenticatedKey } from "../apiKeys";
import { can, effectiveRole, type PermissionUser } from "../permissions";

/**
 * The MCP authentication adapter: an API key plus the entitlement checks that belong to
 * the MCP audience, on top of the shared key lookup in `apiKeys.ts`.
 *
 * Two rules from the spec live here because they are properties of the credential, not of
 * any one tool:
 *
 * 1. The two MCP scopes never share a key. The operator console refuses to issue such a
 *    key, and this refuses to serve one — a hand-edited row must not undo the only
 *    mechanical boundary between the User and Publisher audiences.
 * 2. The owner is re-checked on every call (spec §3.2): a reviewer demoted to member, or
 *    an account suspended, loses their Publisher key's power on the next request, without
 *    anyone having to remember to revoke it. Entitlement comes from `can()` — the MCP
 *    layer must not invent its own tier or role logic.
 */
export type McpAudience = "user" | "publisher";

export const MCP_ENDPOINTS: Record<McpAudience, string> = {
  user: "/api/mcp/user",
  publisher: "/api/mcp/publisher",
};

const AUDIENCE_SCOPE: Record<McpAudience, ApiScope | ApiScope[]> = {
  user: "mcp:user",
  // Either publisher scope opens this endpoint; each tool then checks its own scope.
  publisher: [...PUBLISHER_SCOPES, "admin:manage"],
};

export interface McpAuthContext {
  audience: McpAudience;
  key: AuthenticatedKey;
  /** The account the key is bound to; MCP never serves a key without one. */
  owner: PermissionUser & { suspendedAt: Date | null };
  /** Audit actor for write tools. */
  actorId: string;
}

export type McpAuthOutcome =
  | { ok: true; context: McpAuthContext; remaining: number; resetAt: number }
  | { ok: false; status: 401 | 403 | 429; code: string; message: string; retryAfter?: number; keyId?: string };

const FAILURE_RESPONSE: Record<AuthFailure, { status: 401 | 403 | 429; code: string; message: string }> = {
  missing: { status: 401, code: "unauthorized", message: "Provide an MCP API key as 'Authorization: Bearer <key>'." },
  malformed: { status: 401, code: "unauthorized", message: "Authorization header is not a valid bearer API key." },
  unknown: { status: 401, code: "unauthorized", message: "API key is not recognised." },
  revoked: { status: 401, code: "key_revoked", message: "This API key has been revoked." },
  forbidden: { status: 403, code: "insufficient_scope", message: "This API key lacks the scope for this MCP server." },
  rate_limited: { status: 429, code: "rate_limited", message: "Rate limit exceeded for this API key." },
};

/**
 * The entitlement half of the check, pure so it can be tested without a database.
 *
 * `user` follows the permission matrix: the paid entitlement (`api.use` — professional or
 * founding) or an operations role (`admin.access` — reviewer or admin). `publisher`
 * requires the editorial role itself (`admin.review`), because drafting into the review
 * queue is review-adjacent work, not a reader feature.
 */
export function entitlementRefusal(
  owner: (PermissionUser & { suspendedAt?: Date | null }) | null,
  audience: McpAudience,
): { code: string; message: string } | null {
  if (!owner) {
    return { code: "unbound_key", message: "This API key is not bound to an account, so it cannot be used with MCP." };
  }
  if (owner.suspendedAt) {
    return { code: "account_suspended", message: "The account this API key belongs to is suspended." };
  }
  if (audience === "user" && !(can(owner, "api.use") || can(owner, "admin.access"))) {
    return { code: "plan_required", message: "The Tline User MCP is currently open to professional, founding, reviewer and admin accounts." };
  }
  if (audience === "publisher" && !can(owner, "admin.review")) {
    return { code: "role_required", message: `The Tline Publisher MCP requires a reviewer or admin account (this key's account is ${effectiveRole(owner) ?? "unrecognised"}).` };
  }
  return null;
}

export async function authenticateMcp(header: string | null, audience: McpAudience): Promise<McpAuthOutcome> {
  const result = await authenticate(header, AUDIENCE_SCOPE[audience]);
  if ("failure" in result) {
    const failure = FAILURE_RESPONSE[result.failure];
    return { ok: false, ...failure, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}), ...(result.keyId ? { keyId: result.keyId } : {}) };
  }
  const key = result.key;
  // The console blocks this combination at issue time; serving one anyway would merge the
  // two audiences onto a single credential, so it is refused here too. The publisher
  // scopes may share a key with each other — one publisher, full flow.
  if (key.scopes.includes("mcp:user") && key.scopes.some((scope) => scope !== "mcp:user" && MCP_SCOPES.includes(scope))) {
    return { ok: false, status: 403, code: "scope_conflict", message: "This key carries the user MCP scope together with a publisher scope; the two audiences require separate keys." };
  }
  const refusal = entitlementRefusal(key.owner, audience);
  if (refusal) return { ok: false, status: 403, ...refusal };
  const owner = key.owner!;
  return {
    ok: true,
    context: {
      audience,
      key,
      owner: { id: owner.id, email: owner.email, tier: owner.tier, role: owner.role, suspendedAt: owner.suspendedAt },
      actorId: owner.id,
    },
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}
