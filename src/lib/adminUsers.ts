import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ROLES, type Role, isRole } from "./permissions";

/**
 * Query construction and the guard rails for account administration.
 *
 * Kept out of the page and the server actions so both agree on what a filter means, and
 * so the rules that stop an operator locking everyone out are testable without a browser.
 */

export const TIERS = ["free", "professional", "enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * The tiers to offer for an account, with whatever it holds now first.
 *
 * Older rows carry values this list never defined ("pro", "trader") from before the tier
 * matrix settled. Dropping them from the picker would show the operator a selection the
 * account does not actually have, and saving the form would then change a tier nobody
 * meant to change. Showing the real value keeps the screen honest.
 */
export function tierOptions(current: string): { value: string; legacy: boolean }[] {
  const known = TIERS.map((tier) => ({ value: tier, legacy: false }));
  return isTier(current) ? known : [{ value: current, legacy: true }, ...known];
}

export const USER_STATUSES = ["active", "suspended", "invited"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_SORTS = ["recent", "oldest", "active", "email"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export interface UserFilters {
  q?: string;
  role?: string;
  tier?: string;
  status?: string;
  sort?: string;
}

/** `undefined` for anything unrecognised, so a hand-typed query string cannot widen a filter. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function userWhere(filters: UserFilters): Prisma.UserWhereInput {
  const role = pick(filters.role, ROLES);
  const tier = pick(filters.tier, TIERS);
  const status = pick(filters.status, USER_STATUSES);
  const q = filters.q?.trim();

  return {
    ...(role ? { role } : {}),
    ...(tier ? { tier } : {}),
    // "invited" is an account that arrived by email link and has never set a password:
    // it can receive mail but cannot yet sign in by itself, which is worth seeing apart
    // from a working account.
    ...(status === "suspended" ? { suspendedAt: { not: null } } : {}),
    ...(status === "active" ? { suspendedAt: null } : {}),
    ...(status === "invited" ? { suspendedAt: null, passwordHash: null } : {}),
    // SQLite has no case-insensitive `mode`, so matching is left to the database's own
    // collation rather than a filter Postgres would honour and SQLite would silently drop.
    ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {}),
  };
}

export function userOrderBy(sort: string | undefined): Prisma.UserOrderByWithRelationInput[] {
  switch (pick(sort, USER_SORTS)) {
    case "oldest": return [{ createdAt: "asc" }];
    case "active": return [{ lastSeenAt: "desc" }, { createdAt: "desc" }];
    case "email": return [{ email: "asc" }];
    default: return [{ createdAt: "desc" }];
  }
}

export function statusOf(user: { suspendedAt: Date | null; passwordHash: string | null }): UserStatus {
  if (user.suspendedAt) return "suspended";
  return user.passwordHash ? "active" : "invited";
}

export type RoleChangeRefusal = "unknown_role" | "self_demotion" | "last_admin";

/**
 * Whether a role change is allowed, and why not when it is not.
 *
 * Two ways exist to lose the console entirely: demote yourself, or demote whoever was
 * the last admin. Both are refused here rather than in the UI, because the UI is not
 * what a determined form submission talks to.
 */
export function refuseRoleChange(input: {
  actorId: string;
  targetId: string;
  nextRole: string;
  currentRole: string;
  adminCount: number;
}): RoleChangeRefusal | null {
  if (!isRole(input.nextRole)) return "unknown_role";
  if (input.nextRole === input.currentRole) return null;
  if (input.actorId === input.targetId && input.nextRole !== "admin") return "self_demotion";
  if (input.currentRole === "admin" && input.nextRole !== "admin" && input.adminCount <= 1) return "last_admin";
  return null;
}

export interface UserListRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tier: string;
  status: UserStatus;
  createdAt: Date;
  lastSeenAt: Date | null;
  watchlist: number;
  rules: number;
}

export const USER_PAGE_SIZE = 50;

export async function listUsers(filters: UserFilters, page: number) {
  const where = userWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: userOrderBy(filters.sort),
      skip: Math.max(0, page - 1) * USER_PAGE_SIZE,
      take: USER_PAGE_SIZE,
      select: {
        id: true, email: true, name: true, role: true, tier: true,
        createdAt: true, lastSeenAt: true, suspendedAt: true, passwordHash: true,
        _count: { select: { watchlist: true, rules: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const users: UserListRow[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: isRole(row.role) ? row.role : "member",
    tier: row.tier,
    status: statusOf(row),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    watchlist: row._count.watchlist,
    rules: row._count.rules,
  }));
  return { users, total, pages: Math.max(1, Math.ceil(total / USER_PAGE_SIZE)) };
}

export function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "admin" satisfies Role, suspendedAt: null } });
}
