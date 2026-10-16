/**
 * The result envelope every MCP tool returns, in one place.
 *
 * Agents consume `structuredContent`; the text half exists so a host that only forwards
 * text still sees the same JSON, and so a failure is readable inline in a transcript. The
 * error shape is fixed by the MCP-001 spec: `{ error: { code, message, details? } }`, with
 * codes drawn from a closed set so a client can branch on them without parsing prose.
 */
export type McpErrorCode =
  | "NOT_FOUND"
  | "INVALID_RANGE"
  | "VALIDATION_FAILED"
  | "VERSION_CONFLICT"
  | "SCOPE_DENIED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface McpToolErrorBody {
  error: { code: McpErrorCode; message: string; details?: Record<string, unknown> };
}

export interface McpToolResult {
  /** Open to extra keys because that is the shape the MCP SDK's CallToolResult expects. */
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/** A successful tool result: the structured payload, mirrored as text JSON. */
export function ok<T extends object>(structured: T, text?: string): McpToolResult {
  return { content: [{ type: "text", text: text ?? JSON.stringify(structured) }], structuredContent: structured as Record<string, unknown> };
}

/**
 * A failed tool result. `isError` marks it for the model rather than the transport, so a
 * business failure (a stale version, an unknown draft) stays a tool-level outcome an agent
 * can reason about — it is not a protocol error and must not abort the whole call.
 */
export function fail(code: McpErrorCode, message: string, details?: Record<string, unknown>): McpToolResult {
  const body: McpToolErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
  return { ...ok({ ...body }), isError: true };
}

/**
 * Wrap a tool handler so an unexpected throw becomes an INTERNAL_ERROR result instead of
 * an uncaught exception.
 *
 * The message is deliberately generic: the spec forbids returning stack traces or database
 * errors to clients. The event is logged server-side with the tool name for the operator.
 */
export function toolGuard<Args>(toolName: string, handler: (args: Args) => Promise<McpToolResult>) {
  return async (args: Args): Promise<McpToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      console.error(JSON.stringify({ event: "mcp.tool.failed", tool: toolName, error: String(error) }));
      return fail("INTERNAL_ERROR", "The request could not be completed.");
    }
  };
}
