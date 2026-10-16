import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUserServer, type UserToolDeps } from "./userServer";
import { createPublisherServer, type PublisherToolDeps } from "./publisherServer";
import type { McpAuthContext } from "./auth";

/**
 * Protocol-level end-to-end: a real MCP client against a real MCP server over an
 * in-memory transport, with the tool dependencies faked so the test needs no database.
 * What it proves is exactly the boundary this phase exists for: each server lists only
 * its own tools, and the envelopes, resources and prompts survive a real client.
 */

const USER_TOOLS = ["get_macro_calendar", "get_macro_indicator", "get_research", "list_institutions", "search_research"];
const PUBLISHER_TOOLS = ["create_publication_draft", "list_publication_drafts", "publish_publication_draft", "submit_publication_for_review", "update_publication_draft", "validate_publication_draft"];

function structured<T>(result: unknown): T {
  // callTool's return type is a union; the structured half is what every Tline tool returns.
  const value = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
  assert.ok(value, "expected structuredContent");
  return value as T;
}

const userDeps: UserToolDeps = {
  searchResearch: async (input) => ({
    ok: true,
    data: {
      query: input.query,
      asOf: "2026-10-16T00:00:00.000Z",
      results: [{
        id: "a1", slug: "ubs-gold-outlook", kind: "article", title: "Gold outlook",
        institution: { slug: "ubs", name: "UBS" }, publishedAt: "2026-10-15T00:00:00.000Z",
        snippet: "We stay long gold into year-end…", pageUrl: "https://tlines.tech/en/research/ubs-gold-outlook",
      }],
      nextCursor: null,
    },
  }),
  getResearch: async (identifier) => (identifier === "ubs-gold-outlook"
    ? { ok: true, data: { id: "a1", title: { en: "Gold outlook", zh: null }, views: [], pageUrl: "https://tlines.tech/en/research/ubs-gold-outlook", asOf: "2026-10-16T00:00:00.000Z" } }
    : { ok: false, code: "NOT_FOUND", message: "No public report matches that id or slug." }),
  macroIndicator: async (key) => (key === "US_CPI"
    ? {
        ok: true,
        data: {
          key: "US_CPI", name: "US CPI", countryCode: "US", currency: "USD", category: "inflation",
          frequency: "monthly", unit: "index", seasonalAdjustment: "SA", importance: 5,
          points: [{ period: "2026-09-01T00:00:00.000Z", value: "315.2", source: "bls" }],
          sources: [{ provider: "bls", seriesId: "cpi", url: "https://www.bls.gov" }],
          asOf: "2026-10-16T00:00:00.000Z", pageUrl: "https://tlines.tech/en/macro/indicator/US_CPI",
        },
      }
    : { ok: false, code: "NOT_FOUND", message: "Unknown macro indicator." }),
  macroCalendar: async () => ({ ok: true, data: { from: "2026-10-09T00:00:00.000Z", to: "2026-11-15T00:00:00.000Z", asOf: "2026-10-16T00:00:00.000Z", entries: [] } }),
  listInstitutions: async () => ({ ok: true, data: { institutions: [], nextCursor: null } }),
};

const publisherDto = {
  id: "d1", title: "Desk note", status: "DRAFT", version: 1, language: "en",
  summary: "A one-sentence conclusion.",
  sourceUrl: "https://example.com/note", institutionSlug: "ubs", sourcePublishedAt: null,
  validationIssues: [], submittedAt: null, publishedArticleId: null,
  contentHash: "a".repeat(64),
  createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
};

const publisherDeps: PublisherToolDeps = {
  createDraft: async () => ({ ok: true, data: { ...publisherDto } }),
  updateDraft: async () => ({ ok: true, data: { ...publisherDto, version: 2 } }),
  validateDraft: async () => ({ ok: true, data: { ...publisherDto } }),
  // A stale submit must come back as the tool-level VERSION_CONFLICT envelope, not a protocol error.
  submitDraft: async () => ({ ok: false, code: "VERSION_CONFLICT", message: "The draft has moved on since this version was read.", details: { currentVersion: 2 } }),
  publishDraft: async () => ({
    ok: true,
    data: {
      draft: { ...publisherDto, status: "PUBLISHED", version: 2, publishedArticleId: "a1" },
      article: { id: "a1", slug: "ubs-desk-note-abc123", pageUrl: "https://tlines.tech/en/research/ubs-desk-note-abc123", indexableEn: true, indexableZh: false, gateIssues: ["missing_translation"], documentReady: true },
    },
  }),
  listDrafts: async () => ({ ok: true, data: { drafts: [{ ...publisherDto }], nextCursor: null } }),
};

const publisherContext: McpAuthContext = {
  audience: "publisher",
  key: { id: "key_1", name: "ops", scopes: ["publisher:draft"], rateLimit: 60, owner: { id: "u1", email: "ops@tlines.tech", tier: "free", role: "reviewer", suspendedAt: null } },
  owner: { id: "u1", email: "ops@tlines.tech", tier: "free", role: "reviewer", suspendedAt: null },
  actorId: "u1",
};

/** The same operator, but on a key that was explicitly granted the publish scope. */
const publishingContext: McpAuthContext = {
  ...publisherContext,
  key: { ...publisherContext.key, id: "key_2", scopes: ["publisher:draft", "publisher:publish"] },
};

async function connect(server: ReturnType<typeof createUserServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "protocol-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

test("each MCP server lists only its own tools", async () => {
  const user = await connect(createUserServer(userDeps));
  const userTools = (await user.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(userTools, USER_TOOLS);
  // The isolation criterion: no publisher tool may appear on the user server, and vice versa.
  for (const name of PUBLISHER_TOOLS) assert.ok(!userTools.includes(name), `user server exposed ${name}`);
  // Every user tool is read-only, non-destructive and idempotent by declaration.
  for (const tool of (await user.listTools()).tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} must not be destructive`);
  }

  const publisher = await connect(createPublisherServer(publisherContext, publisherDeps));
  const publisherTools = (await publisher.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(publisherTools, PUBLISHER_TOOLS);
  for (const name of USER_TOOLS) assert.ok(!publisherTools.includes(name), `publisher server exposed ${name}`);
  // Taking content down stays an operations action: no withdraw/delete/reject tool exists.
  for (const banned of ["withdraw", "delete", "reject", "unpublish"]) {
    assert.ok(!publisherTools.some((name) => name.includes(banned)), `publisher server must not expose ${banned}`);
  }
});

test("a user tool call returns the structured envelope end-to-end", async () => {
  const client = await connect(createUserServer(userDeps));
  const result = await client.callTool({ name: "search_research", arguments: { query: "gold", limit: 5 } });
  assert.ok(!result.isError);
  const data = structured<{ results: Array<{ slug: string; pageUrl: string }>; nextCursor: string | null }>(result);
  assert.equal(data.results[0]?.slug, "ubs-gold-outlook");
  assert.match(data.results[0]?.pageUrl ?? "", /^https:\/\/tlines\.tech\//);
  assert.equal(data.nextCursor, null);
  // The text half mirrors the structured half.
  const content = (result as { content: Array<{ type: "text"; text: string }> }).content;
  const text = content[0]!.text;
  assert.equal((JSON.parse(text) as { results: unknown[] }).results.length, 1);

  const missing = await client.callTool({ name: "get_research", arguments: { identifier: "nope" } });
  assert.equal(missing.isError, true);
  assert.equal(structured<{ error: { code: string } }>(missing).error.code, "NOT_FOUND");
});

test("resources and prompts are discoverable and bounded by the same deps", async () => {
  const client = await connect(createUserServer(userDeps));
  const templates = (await client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate).sort();
  assert.deepEqual(templates, ["tline://macro/{key}", "tline://research/{slug}"]);

  const resource = await client.readResource({ uri: "tline://research/ubs-gold-outlook" });
  const payload = JSON.parse((resource.contents[0] as { text: string }).text) as { id: string };
  assert.equal(payload.id, "a1");

  const prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name).sort();
  assert.deepEqual(prompts, ["build_monitoring_plan", "compare_institution_views", "daily_macro_brief"]);
  const brief = await client.getPrompt({ name: "daily_macro_brief", arguments: { economy: "US" } });
  const briefText = (brief.messages[0]?.content as { type: "text"; text: string }).text;
  assert.match(briefText, /get_macro_calendar/);
  assert.match(briefText, /countryCode = 'US'/);
});

test("a publisher submission conflict stays a tool-level error", async () => {
  const client = await connect(createPublisherServer(publisherContext, publisherDeps));
  const created = await client.callTool({ name: "create_publication_draft", arguments: { title: "Desk note on rates", content: "x".repeat(120) } });
  assert.ok(!created.isError);
  assert.equal(structured<{ id: string; version: number }>(created).id, "d1");

  const conflict = await client.callTool({ name: "submit_publication_for_review", arguments: { id: "d1", version: 1 } });
  assert.equal(conflict.isError, true);
  const body = structured<{ error: { code: string; details?: { currentVersion?: number } } }>(conflict);
  assert.equal(body.error.code, "VERSION_CONFLICT");
  assert.equal(body.error.details?.currentVersion, 2);

  const listed = await client.callTool({ name: "list_publication_drafts", arguments: {} });
  assert.ok(!listed.isError);
  assert.equal(structured<{ drafts: unknown[] }>(listed).drafts.length, 1);
});

test("publishing is refused without the publisher:publish scope", async () => {
  const client = await connect(createPublisherServer(publisherContext, publisherDeps));
  const denied = await client.callTool({ name: "publish_publication_draft", arguments: { id: "d1", version: 1, expectedContentHash: "a".repeat(64) } });
  assert.equal(denied.isError, true);
  assert.equal(structured<{ error: { code: string } }>(denied).error.code, "SCOPE_DENIED");
});

test("a publish-scoped key publishes and gets the gate verdict back", async () => {
  const client = await connect(createPublisherServer(publishingContext, publisherDeps));
  const published = await client.callTool({ name: "publish_publication_draft", arguments: { id: "d1", version: 1, expectedContentHash: "a".repeat(64) } });
  assert.ok(!published.isError);
  const data = structured<{ draft: { status: string }; article: { pageUrl: string; indexableEn: boolean; indexableZh: boolean; gateIssues: string[] } }>(published);
  assert.equal(data.draft.status, "PUBLISHED");
  assert.match(data.article.pageUrl, /^https:\/\/tlines\.tech\/en\/research\//);
  assert.equal(data.article.indexableEn, true);
  assert.deepEqual(data.article.gateIssues, ["missing_translation"]);
});
