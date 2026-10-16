import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, toolGuard } from "./results";
import { readInstitutions, readResearch, readResearchSearch } from "./researchData";
import { readMacroCalendar, readMacroIndicator } from "./macroData";
import { registerUserResources } from "./resources";
import { registerUserPrompts } from "./prompts";
import type { Locale } from "../i18n";

/**
 * The Tline User MCP: read-only access to the public corpus for agents acting on behalf
 * of an entitled account.
 *
 * Every tool is read-only, non-destructive and idempotent, and every one of them asks the
 * same public-boundary function the website asks (`publicationReadyWhere()` inside the
 * data helpers below) — so a report the gate withholds is NOT_FOUND here for the same
 * reason the page 404s, and nothing has to be re-derived in the tool layer.
 *
 * Handlers are registered against an injectable deps object so the protocol-level test
 * can drive a real MCP client through a real server with no database underneath.
 */

export interface UserToolDeps {
  searchResearch: typeof readResearchSearch;
  getResearch: typeof readResearch;
  macroIndicator: typeof readMacroIndicator;
  macroCalendar: typeof readMacroCalendar;
  listInstitutions: typeof readInstitutions;
}

export const defaultUserDeps: UserToolDeps = {
  searchResearch: readResearchSearch,
  getResearch: readResearch,
  macroIndicator: readMacroIndicator,
  macroCalendar: readMacroCalendar,
  listInstitutions: readInstitutions,
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const LOCALE = z.enum(["en", "zh-CN"]).describe("Response language for display text; defaults to en.");

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

export function createUserServer(deps: UserToolDeps = defaultUserDeps): McpServer {
  const server = new McpServer({ name: "tline-user-mcp", version: "1.0.0" }, { instructions: "Read-only access to Tline's published institutional research and macro data. Every result carries its source, an asOf timestamp and a page URL on tlines.tech; cite them rather than restating numbers from memory." });

  server.registerTool("search_research", {
    title: "Search research",
    description: "Search Tline's public institutional research — reports and the asset views extracted from them — newest and most relevant first. Only reports that passed the publication gate are searchable. Returns snippets with page URLs; use get_research for the full derived analysis of one report.",
    inputSchema: {
      query: z.string().min(2).max(200).describe("Free-text query, e.g. 'gold outlook' or '美联储 降息'."),
      locale: LOCALE.optional(),
      institution: z.string().max(120).optional().describe("Publisher slug or name fragment, e.g. 'goldman-sachs'."),
      ticker: z.string().max(24).optional().describe("Asset ticker the report takes a view on, e.g. 'XAUUSD' or 'AAPL'."),
      economy: z.string().max(64).optional().describe("Jurisdiction taxonomy key the report is classified under, e.g. 'us'."),
      topic: z.string().max(64).optional().describe("Topic taxonomy key, e.g. 'monetary-policy'."),
      dateFrom: z.string().optional().describe("ISO-8601 lower bound on publication date."),
      dateTo: z.string().optional().describe("ISO-8601 upper bound on publication date."),
      cursor: z.string().max(200).optional().describe("Opaque cursor from a previous call's nextCursor."),
      limit: z.number().int().min(1).max(20).optional().describe("Results per page, 1-20; default 10."),
    },
    outputSchema: {
      query: z.string(),
      asOf: z.string(),
      results: z.array(z.object({
        id: z.string(), slug: z.string(), kind: z.enum(["article", "view"]), title: z.string(),
        institution: z.object({ slug: z.string(), name: z.string() }).optional(),
        publishedAt: z.string().optional(), snippet: z.string().optional(), pageUrl: z.string(),
      })),
      nextCursor: z.string().nullable(),
    },
    annotations: READ_ONLY,
  }, toolGuard("search_research", async (args) => {
    const dateFrom = parseDate(args.dateFrom);
    const dateTo = parseDate(args.dateTo);
    if ((args.dateFrom && !dateFrom) || (args.dateTo && !dateTo)) return fail("INVALID_RANGE", "dateFrom/dateTo must be ISO-8601 dates.");
    const outcome = await deps.searchResearch({
      query: args.query,
      locale: (args.locale ?? "en") as Locale,
      institution: args.institution,
      ticker: args.ticker,
      economy: args.economy,
      topic: args.topic,
      dateFrom,
      dateTo,
      cursor: args.cursor,
      limit: args.limit ?? 10,
    });
    if (!outcome.ok) return fail(outcome.code, outcome.message);
    return ok(outcome.data);
  }));

  server.registerTool("get_research", {
    title: "Get research report",
    description: "Fetch one public report's Tline-derived analysis by id or slug: summary, key arguments, key numbers, risks, asset views with directions and targets, and bilingual titles. Never returns the publisher's original text, translation body or PDF — those are not distributed by Tline.",
    inputSchema: {
      identifier: z.string().min(1).max(200).describe("The report's id or public slug."),
      locale: LOCALE.optional(),
    },
    outputSchema: z.looseObject({ id: z.string(), pageUrl: z.string(), asOf: z.string() }),
    annotations: READ_ONLY,
  }, toolGuard("get_research", async (args) => {
    const outcome = await deps.getResearch(args.identifier, (args.locale ?? "en") as Locale);
    if (!outcome.ok) return fail(outcome.code, outcome.message);
    return ok(outcome.data);
  }));

  server.registerTool("get_macro_indicator", {
    title: "Get macro indicator",
    description: "Read one macro indicator's latest-vintage observations by canonical key (e.g. 'US_CPI', 'EU_HICP'), plus its definition (country, frequency, unit, seasonal adjustment), the series sources and a page URL. Points are newest first; each period appears once, at its latest vintage.",
    inputSchema: {
      key: z.string().min(2).max(64).describe("Canonical indicator key, e.g. 'US_CPI'."),
      from: z.string().optional().describe("ISO-8601 lower bound on observation period."),
      to: z.string().optional().describe("ISO-8601 upper bound on observation period."),
      limit: z.number().int().min(1).max(120).optional().describe("Observation count, 1-120; default 24."),
      locale: LOCALE.optional(),
    },
    outputSchema: {
      key: z.string(), name: z.string(), countryCode: z.string(), currency: z.string().nullable(),
      category: z.string(), frequency: z.string(), unit: z.string(), seasonalAdjustment: z.string().nullable(),
      importance: z.number(),
      points: z.array(z.object({ period: z.string(), value: z.string(), source: z.string() })),
      sources: z.array(z.object({ provider: z.string(), seriesId: z.string(), url: z.string().nullable() })),
      asOf: z.string().nullable(), pageUrl: z.string(),
    },
    annotations: READ_ONLY,
  }, toolGuard("get_macro_indicator", async (args) => {
    const from = parseDate(args.from);
    const to = parseDate(args.to);
    if ((args.from && !from) || (args.to && !to)) return fail("INVALID_RANGE", "from/to must be ISO-8601 dates.");
    const outcome = await deps.macroIndicator(args.key, { from, to, limit: args.limit ?? 24, locale: (args.locale ?? "en") as Locale });
    if (!outcome.ok) return fail(outcome.code, outcome.message);
    return ok(outcome.data);
  }));

  server.registerTool("get_macro_calendar", {
    title: "Get macro calendar",
    description: "Read the economic release calendar: what is scheduled and what has landed, with previous/consensus/actual and revisions per indicator. Window defaults to the last 7 days through the next 30 days and may span at most 366 days. Consensus values are included only where the data licence permits machine-consumer use.",
    inputSchema: {
      from: z.string().optional().describe("ISO-8601 start; defaults to 7 days ago."),
      to: z.string().optional().describe("ISO-8601 end; defaults to 30 days ahead."),
      countryCode: z.string().max(8).optional().describe("ISO country code, e.g. 'US'."),
      importance: z.number().int().min(1).max(5).optional().describe("Only releases at or above this importance (1-5)."),
      limit: z.number().int().min(1).max(200).optional().describe("Release count, 1-200; default 50."),
      locale: LOCALE.optional(),
    },
    outputSchema: {
      from: z.string(), to: z.string(), asOf: z.string(),
      entries: z.array(z.object({
        id: z.string(), title: z.string(), countryCode: z.string(), currency: z.string().nullable(),
        agency: z.string(), importance: z.number(), status: z.string(),
        scheduledAt: z.string(), releasedAt: z.string().nullable(), pageUrl: z.string(),
        values: z.array(z.object({
          indicator: z.object({ key: z.string(), name: z.string() }),
          period: z.string(), previous: z.string().nullable(), revisedPrevious: z.string().nullable(),
          consensus: z.string().nullable(), actual: z.string().nullable(),
        })),
      })),
    },
    annotations: READ_ONLY,
  }, toolGuard("get_macro_calendar", async (args) => {
    const from = parseDate(args.from) ?? new Date(Date.now() - 7 * 86_400_000);
    const to = parseDate(args.to) ?? new Date(Date.now() + 30 * 86_400_000);
    if ((args.from && !parseDate(args.from)) || (args.to && !parseDate(args.to))) return fail("INVALID_RANGE", "from/to must be ISO-8601 dates.");
    const outcome = await deps.macroCalendar({
      from, to,
      countryCode: args.countryCode,
      importance: args.importance,
      limit: args.limit ?? 50,
      locale: (args.locale ?? "en") as Locale,
    });
    if (!outcome.ok) return fail(outcome.code, outcome.message);
    return ok(outcome.data);
  }));

  server.registerTool("list_institutions", {
    title: "List institutions",
    description: "List the institutions that have at least one public report, with country, authority score and the count of public reports. Cursor-paginated.",
    inputSchema: {
      country: z.string().max(64).optional().describe("Publisher country filter, e.g. 'United States'."),
      cursor: z.string().max(200).optional().describe("Opaque cursor from a previous call's nextCursor."),
      limit: z.number().int().min(1).max(100).optional().describe("Institutions per page, 1-100; default 50."),
      locale: LOCALE.optional(),
    },
    outputSchema: {
      institutions: z.array(z.object({
        slug: z.string(), name: z.string(), country: z.string().nullable(),
        authorityScore: z.number().nullable(), reportCount: z.number(), pageUrl: z.string(),
      })),
      nextCursor: z.string().nullable(),
    },
    annotations: READ_ONLY,
  }, toolGuard("list_institutions", async (args) => {
    const outcome = await deps.listInstitutions({ country: args.country, cursor: args.cursor, limit: args.limit ?? 50, locale: (args.locale ?? "en") as Locale });
    if (!outcome.ok) return fail(outcome.code, outcome.message);
    return ok(outcome.data);
  }));

  registerUserResources(server, deps);
  registerUserPrompts(server);
  return server;
}
