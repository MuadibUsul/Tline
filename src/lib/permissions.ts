export type PermissionAction =
  | "article.read.original"
  | "article.read.translation"
  | "document.download.original"
  | "watchlist.manage"
  | "alerts.manage"
  | "api.use"
  // Console actions. `admin.access` is the door; the rest are the rooms behind it.
  | "admin.access"
  | "admin.review"
  | "admin.sources"
  | "admin.analytics"
  | "admin.users"
  | "admin.api"
  | "admin.models"
  | "admin.social"
  | "admin.audit";

export interface PermissionUser {
  id: string;
  tier: string;
  role?: string;
  email?: string;
}

/** Ordered least to most privileged; anything unrecognised is treated as `member`. */
export const ROLES = ["member", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { member: 0, reviewer: 1, admin: 2 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Emails in `ADMIN_EMAILS` are always admin, whatever the database says.
 *
 * This is the escape hatch: roles are now editable from the console itself, and the one
 * failure mode that has no in-product remedy is an operator demoting the last admin —
 * including themselves. An allowlist that no console action can touch means the owner can
 * always get back in.
 */
export function isOperationsOwner(user: PermissionUser | null): boolean {
  const owners = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(user?.email && owners.includes(user.email.toLowerCase()));
}

/** The role actually in force for this user, after the owner allowlist is applied. */
export function effectiveRole(user: PermissionUser | null): Role | null {
  if (!user) return null;
  if (isOperationsOwner(user)) return "admin";
  return isRole(user.role) ? user.role : "member";
}

function atLeast(user: PermissionUser | null, role: Role): boolean {
  const actual = effectiveRole(user);
  return actual !== null && RANK[actual] >= RANK[role];
}

/** Single authorization boundary. The commercial tier matrix is intentionally deferred. */
export function can(user: PermissionUser | null, action: PermissionAction): boolean {
  switch (action) {
    case "article.read.original":
    case "article.read.translation":
    case "document.download.original":
      return true;
    case "watchlist.manage":
    case "alerts.manage":
      return user !== null;
    case "api.use":
      return user?.tier === "professional";
    // A reviewer is an editorial role: they judge content and want to see how it lands,
    // so review and the read-only analytics come with the job. Anything that changes who
    // can sign in, what the crawler does, or which machines hold a key is an admin's.
    case "admin.access":
    case "admin.review":
    case "admin.analytics":
      return atLeast(user, "reviewer");
    case "admin.sources":
    case "admin.users":
    case "admin.api":
    // Model providers hold credentials and decide what every pipeline run spends. Admin
    // only, for the same reason API keys are.
    case "admin.models":
    case "admin.social":
    case "admin.audit":
      return atLeast(user, "admin");
  }
}
