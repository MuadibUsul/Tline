export type PermissionAction =
  | "article.read.original"
  | "article.read.translation"
  | "document.download.original"
  | "document.download.translation"
  | "watchlist.manage"
  | "alerts.manage"
  | "api.use"
  | "admin.review";

export interface PermissionUser {
  id: string;
  tier: string;
  role?: string;
  email?: string;
}

export function isOperationsOwner(user: PermissionUser | null): boolean {
  const owners = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(user?.email && owners.includes(user.email.toLowerCase()));
}

/** Single authorization boundary. The commercial tier matrix is intentionally deferred. */
export function can(user: PermissionUser | null, action: PermissionAction): boolean {
  switch (action) {
    case "article.read.original":
    case "article.read.translation":
    case "document.download.original":
    case "document.download.translation":
      return true;
    case "watchlist.manage":
    case "alerts.manage":
      return user !== null;
    case "api.use":
      return user?.tier === "professional";
    case "admin.review":
      return isOperationsOwner(user);
  }
}
