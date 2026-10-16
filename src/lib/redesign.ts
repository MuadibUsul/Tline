/**
 * The premium-media redesign's phase switch (docs/redesign/, PRD TL-005).
 *
 * Deliberately a view-layer switch only: it may choose which components render, never
 * which URL is served, what metadata or canonical is emitted, or whether the publication
 * gate is asked. Flipping it back to "off" restores the previous appearance with a
 * container restart and nothing else — that is the point (07-rollback-plan.md §3).
 *
 * Phases are ordered: `design-system` ships the tokens and components, `article` the
 * reworked report page, `home` the front page; `all` is every phase at once.
 */
export const REDESIGN_PHASES = ["off", "design-system", "article", "home", "all"] as const;
export type RedesignPhase = (typeof REDESIGN_PHASES)[number];

/** The ordered phases a named phase includes (each named phase includes the ones before it). */
const ORDER: RedesignPhase[] = ["off", "design-system", "article", "home", "all"];

export function redesignPhase(): RedesignPhase {
  const raw = (process.env.TL_REDESIGN ?? "off").trim().toLowerCase();
  return (REDESIGN_PHASES as readonly string[]).includes(raw) ? (raw as RedesignPhase) : "off";
}

/** True when the redesign is at or past `phase`. `off` is never at or past anything. */
export function redesignAtLeast(phase: Exclude<RedesignPhase, "off">): boolean {
  const current = redesignPhase();
  if (current === "off") return false;
  if (current === "all") return true;
  return ORDER.indexOf(current) >= ORDER.indexOf(phase);
}
