import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recordApiCall } from "../apiUsage";
import { authenticateMcp, MCP_ENDPOINTS, type McpAudience, type McpAuthContext } from "./auth";

/**
 * The shared HTTP glue for both MCP endpoints: authenticate, run one stateless
 * Streamable HTTP exchange, fold the call into the usage aggregate, and stamp the
 * hardening headers (noindex/nofollow, no-store) the spec requires on every answer —
 * including the refusals.
 *
 * Stateless on purpose: every request authenticates, rate-limits and authorises on its
 * own, so nothing about a caller's identity survives in process memory between requests
 * and no session store has to exist. GET and DELETE (session stream, session teardown)
 * have nothing to address in that model, and are answered 405 exactly as the MCP
 * specification prescribes for a stateless server.
 */

/** `no-store` because every payload depends on the caller's key; `noindex` because these are machine endpoints. */
function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("cache-control", "no-store");
  const body = response.body && response.status !== 204 && response.status !== 304 ? response.body : null;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function jsonRpcError(status: number, code: number, message: string, headers?: Record<string, string>): Response {
  return harden(
    new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

const AUTH_CHALLENGE: Record<McpAudience, string> = {
  user: 'Bearer realm="tline-user-mcp"',
  publisher: 'Bearer realm="tline-publisher-mcp"',
};

export function mcpRoute(audience: McpAudience, createServer: (context: McpAuthContext) => McpServer) {
  const endpoint = MCP_ENDPOINTS[audience];
  const maxRequestBodySize = audience === "user" ? 256 * 1024 : 512 * 1024;

  return async function handle(request: Request): Promise<Response> {
    const startedAt = Date.now();
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed: this MCP server is stateless, so only POST is served.", { allow: "POST" });
    }

    const auth = await authenticateMcp(request.headers.get("authorization"), audience);
    if (!auth.ok) {
      recordApiCall(auth.keyId ?? null, endpoint, auth.status, Date.now() - startedAt);
      const headers: Record<string, string> = {};
      if (auth.status === 401) headers["www-authenticate"] = AUTH_CHALLENGE[audience];
      if (auth.retryAfter) headers["retry-after"] = String(auth.retryAfter);
      return jsonRpcError(auth.status, -32001, auth.message, headers);
    }

    const server = createServer(auth.context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
      maxRequestBodySize,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      recordApiCall(auth.context.key.id, endpoint, response.status, Date.now() - startedAt);
      return harden(response);
    } catch (error) {
      recordApiCall(auth.context.key.id, endpoint, 500, Date.now() - startedAt);
      console.error(JSON.stringify({ event: "mcp.request.failed", audience, error: String(error) }));
      return jsonRpcError(500, -32603, "The request could not be completed.");
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };
}
