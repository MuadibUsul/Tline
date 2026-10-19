import assert from "node:assert/strict";
import test from "node:test";
import { announcementLink } from "./homeAnnouncement";

test("a placement points at a local page or an https destination", () => {
  assert.deepEqual(announcementLink("/mcp"), { href: "/mcp", external: false });
  assert.deepEqual(announcementLink("/zh/research?from=home"), { href: "/zh/research?from=home", external: false });
  assert.deepEqual(announcementLink("https://example.com/launch"), { href: "https://example.com/launch", external: true });
});

test("script and protocol-relative destinations are rejected", () => {
  for (const value of [
    "",
    "  ",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://example.com",
    "/ok\u0000",
  ]) {
    assert.equal(announcementLink(value), null, value);
  }
});
