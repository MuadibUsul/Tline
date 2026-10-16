import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { UserToolDeps } from "./userServer";

/**
 * Resources: the same public boundary as the User MCP tools, addressed so an agent can
 * read one document without the payload passing through a tool result. `list` is
 * intentionally undefined — the corpus is enumerated by `search_research`, not by
 * resource listing, so the address space stays a pointer, not a second index.
 */
export function registerUserResources(server: McpServer, deps: UserToolDeps) {
  const variable = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

  server.registerResource(
    "research-report",
    new ResourceTemplate("tline://research/{slug}", { list: undefined }),
    { title: "Tline research report", description: "One public report's Tline-derived analysis, by slug. Same public boundary as get_research.", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variable(variables.slug);
      const outcome = await deps.getResearch(slug, "en");
      if (!outcome.ok) throw new Error(`No public report with slug '${slug}'.`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(outcome.data) }] };
    },
  );

  server.registerResource(
    "macro-indicator",
    new ResourceTemplate("tline://macro/{key}", { list: undefined }),
    { title: "Tline macro indicator", description: "One indicator's definition and latest-vintage observations, by canonical key.", mimeType: "application/json" },
    async (uri, variables) => {
      const key = variable(variables.key);
      const outcome = await deps.macroIndicator(key, { limit: 24, locale: "en" });
      if (!outcome.ok) throw new Error(`Unknown macro indicator '${key}'.`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(outcome.data) }] };
    },
  );
}
