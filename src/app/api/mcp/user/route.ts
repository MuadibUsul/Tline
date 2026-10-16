import { mcpRoute } from "@/lib/mcp/http";
import { createUserServer } from "@/lib/mcp/userServer";

export const dynamic = "force-dynamic";

/**
 * The Tline User MCP — stateless Streamable HTTP, authenticated with an `mcp:user` API
 * key. The route is deliberately thin: transport policy lives in `mcpRoute`, tool
 * registration in `userServer`, and authorization in `authenticateMcp`.
 */
const handler = mcpRoute("user", () => createUserServer());

export const POST = handler;
// Stateless: no session stream to GET, no session to DELETE. Serve the MCP-shaped 405
// rather than letting the framework answer in its own format.
export const GET = handler;
export const DELETE = handler;
