const MAX_SLUG_LENGTH = 120;

/** Build the immutable, human-readable public identifier stored with a report. */
export function buildResearchSlug(input: {
  institution: string;
  title: string;
  fingerprint: string;
}) {
  const suffix = input.fingerprint.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  const readable = `${slugPart(input.institution)}-${slugPart(input.title)}`;
  const room = Math.max(1, MAX_SLUG_LENGTH - suffix.length - 1);
  const prefix = readable.slice(0, room).replace(/-+$/g, "") || "research";
  return `${prefix}-${suffix}`;
}

function slugPart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "research";
}

export function researchPath(article: { slug: string }) {
  return `/research/${article.slug}`;
}

/** Accept the immutable public slug and the pre-slug database ID. */
export function researchLookupWhere(identifier: string) {
  return { OR: [{ id: identifier }, { slug: identifier }] };
}

/** Historical IDs redirect once; the stored slug is already the final public address. */
export function researchRedirectPath(identifier: string, article: { slug: string }) {
  return identifier === article.slug ? null : researchPath(article);
}
