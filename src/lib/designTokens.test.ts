import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function countInlineStyles(directory: string): number {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += countInlineStyles(path);
    else if (entry.name.endsWith(".tsx")) total += (readFileSync(path, "utf8").match(/style=\{\{/g) ?? []).length;
  }
  return total;
}

function luminance(hex: string) {
  const short = hex.replace("#", "");
  const value = short.length === 3 ? short.split("").map((part) => part + part).join("") : short;
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("the token layer keeps the existing brand palette as its primitive source", () => {
  assert.match(css, /--neutral-9:#08090a/);
  assert.match(css, /--indigo-9:#5e6ad2/);
  assert.match(css, /--indigo-dark-9:#7c8aff/);
  assert.match(css, /--action-primary-bg:var\(--indigo-9\)/);
  assert.match(css, /:root\[data-theme="dark"\]\{[\s\S]*--action-primary-bg:var\(--indigo-dark-9\)/);
});

test("primary actions meet 4.5:1 in both themes", () => {
  assert.ok(contrast("#fff", "#5e6ad2") >= 4.5);
  assert.ok(contrast("#08090a", "#7c8aff") >= 4.5);
  assert.match(css, /\.minibtn\.p\{[^}]*color:var\(--button-primary-fg\)/);
  assert.doesNotMatch(css, /\.minibtn\.p\{[^}]*color:#fff/);
});

test("tertiary text and status text meet 4.5:1 against their washes", () => {
  assert.ok(contrast("#636a74", "#f1f2f4") >= 4.5);
  assert.ok(contrast("#858c96", "#1a1d33") >= 4.5);
  assert.ok(contrast("#8a5a12", "#fdf3e3") >= 4.5);
  assert.ok(contrast("#80530f", "#fbf0d9") >= 4.5);
  assert.ok(contrast("#146c4c", "#e8f5ef") >= 4.5);
});

test("control boundaries and focus rings are solid and meet 3:1", () => {
  assert.ok(contrast("#828891", "#fff") >= 3);
  assert.ok(contrast("#62666d", "#0f1011") >= 3);
  assert.match(css, /--border-control:var\(--neutral-5\)/);
  assert.match(css, /--border-control:var\(--neutral-dark-5\)/);
  assert.match(css, /:where\(a,button,input,select,textarea\):focus-visible\{outline:2px solid var\(--focus-ring\)/);
  assert.doesNotMatch(css, /:focus-visible\{outline:2px solid color-mix/);
});

test("inline-style count only ratchets down", () => {
  // 130 is the post-Phase-C baseline (one count per `style={{` occurrence, including
  // multi-line objects). A new inline style must either move to a class/token or come
  // with a deliberate budget update; it must not appear silently.
  const count = countInlineStyles(fileURLToPath(new URL("../app", import.meta.url)));
  assert.ok(count <= 130, `inline style count grew to ${count}; use a class/token or update the documented budget`);
});

test("the legacy variable API still resolves through semantic tokens", () => {
  for (const [legacy, semantic] of [
    ["--bg", "--surface-canvas"],
    ["--panel", "--surface-page"],
    ["--ink", "--text-primary"],
    ["--faint", "--text-tertiary"],
    ["--border", "--border-subtle"],
    ["--accent", "--action-primary-bg"],
    ["--bull", "--status-positive"],
    ["--warn", "--status-warning"],
  ]) {
    assert.match(css, new RegExp(`${legacy}:var\\(${semantic}\\)`), `${legacy} should alias ${semantic}`);
  }
});
