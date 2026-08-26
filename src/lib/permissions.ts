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
      return user?.role === "reviewer" || user?.role === "admin";
  }
}
