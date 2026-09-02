import { NextResponse } from "next/server";
import { authenticate, type ApiScope, type AuthFailure, type AuthenticatedKey } from "./apiKeys";

/**
 * One place where every public API response is shaped, so a caller sees the same error
 * envelope and the same rate-limit headers whichever endpoint they hit.
 */

const FAILURES: Record<AuthFailure, { status: number; code: string; message: string }> = {
  missing: { status: 401, code: "unauthorized", message: "Provide an API key as 'Authorization: Bearer <key>'." },
  malformed: { status: 401, code: "unauthorized", message: "Authorization header is not a valid bearer API key." },
  unknown: { status: 401, code: "unauthorized", message: "API key is not recognised." },
  revoked: { status: 401, code: "key_revoked", message: "This API key has been revoked." },
  forbidden: { status: 403, code: "insufficient_scope", message: "This API key lacks the scope for that resource." },
  rate_limited: { status: 429, code: "rate_limited", message: "Rate limit exceeded for this API key." },
};

export function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/**
 * Wraps a handler so it only runs for a key carrying `scope`. Responses are no-store:
 * the payload depends on the caller's key, so a shared cache must never keep it.
 */
export function withApiKey(
  scope: ApiScope,
  handler: (request: Request, key: AuthenticatedKey) => Promise<unknown>,
) {
  return async (request: Request) => {
    const result = await authenticate(request.headers.get("authorization"), scope);

    if ("failure" in result) {
      const failure = FAILURES[result.failure];
      return apiError(
        failure.code,
        failure.message,
        failure.status,
        result.retryAfter ? { "retry-after": String(result.retryAfter) } : undefined,
      );
    }

    try {
      const body = await handler(request, result.key);
      return NextResponse.json(body, {
        headers: {
          "cache-control": "no-store",
          "x-ratelimit-limit": String(result.key.rateLimit),
          "x-ratelimit-remaining": String(result.remaining),
          "x-ratelimit-reset": String(Math.floor(result.resetAt / 1000)),
        },
      });
    } catch (error) {
      if (error instanceof ApiRequestError) return apiError(error.code, error.message, error.status);
      console.error(JSON.stringify({ event: "api.handler.failed", scope, error: String(error) }));
      return apiError("internal_error", "The request could not be completed.", 500);
    }
  };
}

/** Thrown by handlers for problems the caller can fix, e.g. a bad query parameter. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function intParam(url: URL, name: string, fallback: number, max: number) {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new ApiRequestError("invalid_parameter", `'${name}' must be a positive integer.`);
  return Math.min(value, max);
}

export function dateParam(url: URL, name: string) {
  const raw = url.searchParams.get(name);
  if (!raw) return undefined;
  const value = new Date(raw);
  if (isNaN(value.getTime())) throw new ApiRequestError("invalid_parameter", `'${name}' must be an ISO-8601 date.`);
  return value;
}
