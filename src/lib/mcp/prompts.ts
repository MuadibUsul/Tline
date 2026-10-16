import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompts: discoverable workflows that only *compose* tools. They carry no permission
 * logic — every tool call a prompt leads to is authorised on its own at call time — and
 * they instruct the model to cite `pageUrl`/`asOf` from tool results rather than inventing
 * numbers, which is the failure mode this data exists to prevent.
 */
export function registerUserPrompts(server: McpServer) {
  server.registerPrompt("daily_macro_brief", {
    title: "Daily macro brief",
    description: "Compose a macro brief for an economy and asset scope from the release calendar and indicator series.",
    argsSchema: {
      economy: z.string().optional().describe("Economy or country code to focus on, e.g. 'US'."),
      assetClass: z.string().optional().describe("Asset class to emphasise, e.g. 'rates' or 'fx'."),
      days: z.string().optional().describe("Calendar look-ahead in days; default 30."),
    },
  }, (args) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Prepare a macro brief${args.economy ? ` for ${args.economy}` : ""}${args.assetClass ? `, emphasising ${args.assetClass}` : ""}.`,
          `1. Call get_macro_calendar with from = today and to = today + ${args.days ?? "30"} days${args.economy ? `, countryCode = '${args.economy}'` : ""}, importance >= 3.`,
          "2. For the most important upcoming releases, call get_macro_indicator to show where each series stands (recent points, previous value).",
          "3. Optionally call search_research for recent institutional views on the same economy.",
          "Cite every figure with its pageUrl and asOf from the tool results. Do not state numbers the tools did not return, and say so when a series or consensus value is unavailable.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("compare_institution_views", {
    title: "Compare institution views",
    description: "Compare what several institutions have said about one asset or subject.",
    argsSchema: {
      subject: z.string().describe("Asset, ticker or subject to compare, e.g. 'gold' or 'US rates'."),
      institutions: z.string().optional().describe("Comma-separated institution slugs to restrict the comparison to."),
    },
  }, (args) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Compare institutional views on: ${args.subject}.`,
          "1. Call search_research with a query for the subject and, when given, filter by institution.",
          `2. Call get_research for the most relevant reports${args.institutions ? ` from ${args.institutions}` : ""} to read their asset views, directions and targets.`,
          "3. Present a comparison table: institution, direction, target, horizon, and the report pageUrl. Where institutions disagree, say exactly where; do not average targets.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("build_monitoring_plan", {
    title: "Build monitoring plan",
    description: "Propose a watchlist, dashboard and alert configuration from what the tools return. Phase 1 does not write the configuration — it produces a plan to apply in the Tline console.",
    argsSchema: {
      focus: z.string().optional().describe("What to monitor, e.g. 'euro-area inflation and ECB decisions'."),
    },
  }, (args) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `Propose a monitoring plan${args.focus ? ` for: ${args.focus}` : ""}.`,
          "1. Call list_institutions and search_research to establish which publishers and topics matter here.",
          "2. Call get_macro_calendar over the next quarter to name the releases worth watching, and get_macro_indicator for the series behind them.",
          "3. Return a concrete plan: institutions to watch, tickers and topics, release events to alert on, and the reasoning. Present it for review — do not claim anything was configured, because these tools cannot write.",
        ].join("\n"),
      },
    }],
  }));
}
