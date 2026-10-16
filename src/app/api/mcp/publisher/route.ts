import { mcpRoute } from "@/lib/mcp/http";
import { createPublisherServer } from "@/lib/mcp/publisherServer";

export const dynamic = "force-dynamic";

/**
 * The Tline Publisher MCP — stateless Streamable HTTP, authenticated with a
 * `publisher:draft` API key whose owner is re-checked as a reviewer or admin on every
 * call. Draft tools only; publishing stays in the operations console.
 */
const handler = mcpRoute("publisher", (context) => createPublisherServer(context));

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
