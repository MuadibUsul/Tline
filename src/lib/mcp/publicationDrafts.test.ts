import assert from "node:assert/strict";
import test from "node:test";
import { blockingIssues, validateDraftInput, type DraftInput } from "./publicationDrafts";

const base: DraftInput = {
  title: "Q4 rates outlook from the desk",
  content: "A".repeat(400),
};

test("a well-formed draft has no blocking issues", () => {
  const issues = validateDraftInput(base, new Set(["goldman-sachs"]));
  assert.deepEqual(blockingIssues(issues), []);
  assert.deepEqual(validateDraftInput({ ...base, sourceUrl: "https://example.com/report" }, new Set()).length, 0);
  assert.deepEqual(validateDraftInput({ ...base, language: "zh-CN", sourcePublishedAt: "2026-10-01T00:00:00Z" }, new Set()).length, 0);
});

test("field bounds are enforced on title and content", () => {
  assert.ok(validateDraftInput({ ...base, title: "Short" }, new Set()).some((issue) => issue.code === "title.too_short"));
  assert.ok(validateDraftInput({ ...base, title: "T".repeat(301) }, new Set()).some((issue) => issue.code === "title.too_long"));
  assert.ok(validateDraftInput({ ...base, content: "   " }, new Set()).some((issue) => issue.code === "content.empty" && issue.blocking));
  assert.ok(validateDraftInput({ ...base, content: "B".repeat(99) }, new Set()).some((issue) => issue.code === "content.too_short"));
  assert.ok(validateDraftInput({ ...base, content: "B".repeat(100_001) }, new Set()).some((issue) => issue.code === "content.too_long"));
});

test("repetitive content is a warning, not a blocker", () => {
  const issues = validateDraftInput({ ...base, content: Array.from({ length: 40 }, () => "the same line").join("\n") }, new Set());
  const repetitive = issues.find((issue) => issue.code === "content.repetitive");
  assert.ok(repetitive);
  assert.equal(repetitive.blocking, false);
  assert.deepEqual(blockingIssues(issues), []);
});

test("source URLs must be valid and https", () => {
  assert.ok(validateDraftInput({ ...base, sourceUrl: "http://example.com" }, new Set()).some((issue) => issue.code === "sourceUrl.not_https"));
  assert.ok(validateDraftInput({ ...base, sourceUrl: "not a url" }, new Set()).some((issue) => issue.code === "sourceUrl.invalid"));
});

test("language must parse as BCP-47", () => {
  assert.ok(validateDraftInput({ ...base, language: "english please" }, new Set()).some((issue) => issue.code === "language.invalid"));
  assert.deepEqual(blockingIssues(validateDraftInput({ ...base, language: "en-GB" }, new Set())), []);
});

test("publication dates must parse and not be in the future", () => {
  assert.ok(validateDraftInput({ ...base, sourcePublishedAt: "yesterday" }, new Set()).some((issue) => issue.code === "sourcePublishedAt.invalid"));
  const farFuture = new Date(Date.now() + 72 * 3600_000).toISOString();
  assert.ok(validateDraftInput({ ...base, sourcePublishedAt: farFuture }, new Set()).some((issue) => issue.code === "sourcePublishedAt.future"));
  // A stored Date (revalidation path) is judged the same way as an ISO string.
  assert.ok(validateDraftInput({ ...base, sourcePublishedAt: new Date(Date.now() + 72 * 3600_000) }, new Set()).some((issue) => issue.code === "sourcePublishedAt.future"));
  assert.deepEqual(blockingIssues(validateDraftInput({ ...base, sourcePublishedAt: new Date(Date.now() - 3600_000) }, new Set())), []);
});

test("an institution slug must be registered", () => {
  assert.ok(validateDraftInput({ ...base, institutionSlug: "nobody" }, new Set(["ubs"])).some((issue) => issue.code === "institution.unknown" && issue.blocking));
  assert.deepEqual(blockingIssues(validateDraftInput({ ...base, institutionSlug: "ubs" }, new Set(["ubs"]))), []);
});
