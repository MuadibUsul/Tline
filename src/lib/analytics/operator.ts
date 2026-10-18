import { prisma } from "../db";
import { can, type PermissionUser } from "../permissions";

/**
 * Operator traffic is not audience traffic.
 *
 * A signed-in admin is running the site, not reading it. Excluding the account at the
 * beacon also keeps the operator's own tests, QA pages and repeated dashboard checks out of
 * every human metric; no query has to remember a second filter.
 */
export function isOperatorAccount(user: PermissionUser | null): boolean {
  return can(user, "admin.access");
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; at: number }>();

/** The same check for callers that only hold a userId (server-side events). */
export async function isOperatorUserId(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, tier: true },
  });
  const value = isOperatorAccount(user);
  cache.set(userId, { value, at: Date.now() });
  if (cache.size > 2000) cache.clear();
  return value;
}
