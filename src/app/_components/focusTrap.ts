const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Keeps Tab and Shift+Tab inside an open modal. A dialog that visually covers the
 * page must also contain keyboard focus; otherwise the reader lands on links they
 * cannot see behind the overlay.
 */
export function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const nodes = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((node) => node.getClientRects().length > 0);
  if (nodes.length === 0) {
    event.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!container.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
