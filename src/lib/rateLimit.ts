/**
 * Fixed-window limiter for expensive public endpoints.
 *
 * Deliberately in-process: it caps what a single instance will do for one caller, which
 * is what protects this box's CPU and memory. It is not a distributed quota — behind
 * several replicas each one enforces its own window. Move to a shared store only when
 * the deployment actually runs multiple instances.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired windows so an IP-keyed map cannot grow without bound. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  sweep(now);
  const existing = windows.get(key);
  const window = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  window.count += 1;
  windows.set(key, window);
  const allowed = window.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - window.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client identity. `x-forwarded-for` is only trustworthy behind a proxy that
 * sets it; without one every caller collapses into a single bucket, which fails closed
 * (shared limit) rather than open.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

/** Test seam: the module-level map otherwise leaks state between cases. */
export function resetRateLimits() {
  windows.clear();
  lastSweep = 0;
}
