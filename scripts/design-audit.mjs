import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/**
 * Reproducible design-system audit.
 *
 * Run against a local production build:
 *   TL_REDESIGN=all TLINE_DIST_DIR=.next-verify npm run build
 *   TL_REDESIGN=all TLINE_DIST_DIR=.next-verify npx next start -p 3100
 *   DESIGN_AUDIT_BASE=http://127.0.0.1:3100 npm run design:audit
 *
 * To include the authenticated console, also set ADMIN_COOKIE to a local signed
 * ii_session token. Without it the public audit runs and reports admin as skipped.
 *
 * It checks reflow at phone/tablet/desktop widths, one h1 per page, dark/light
 * primary contrast, the input focus ring, theme persistence, and forced-colors
 * rendering. It exits non-zero on a violation so a release can gate on it.
 */
const base = (process.env.DESIGN_AUDIT_BASE || "http://127.0.0.1:3100").replace(/\/$/, "");
const adminCookie = (process.env.ADMIN_COOKIE || "").trim();
const executablePath = process.env.CHROME_PATH
  || (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);

const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: "chrome", headless: true });
const failures = [];
const notes = [];
const seenFailures = new Set();
const seenNotes = new Set();

function rgb(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  return match[1].split(",").slice(0, 3).map((part) => Number(part.trim()));
}
function luminance([r, g, b]) {
  const channels = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function fail(message) {
  if (seenFailures.has(message)) return;
  seenFailures.add(message);
  failures.push(message);
}
function note(message) {
  if (seenNotes.has(message)) return;
  seenNotes.add(message);
  notes.push(message);
}
async function open(width, { dark = false, forcedColors = false, admin = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: dark ? "dark" : "light",
    ...(forcedColors ? { forcedColors: "active" } : {}),
  });
  await context.addCookies([{ name: "tline_consent", value: "denied", domain: new URL(base).hostname, path: "/" }]);
  if (admin && adminCookie) {
    await context.addCookies([{ name: "ii_session", value: adminCookie, domain: new URL(base).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  }
  return { context, page: await context.newPage() };
}
async function measure(page) {
  return page.evaluate(() => {
    const primary = document.querySelector(".minibtn.p");
    const primaryStyle = primary ? getComputedStyle(primary) : null;
    const labelledBy = (element) => {
      const ids = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      return ids.some((id) => document.getElementById(id)?.textContent?.trim());
    };
    const accessibleName = (element) => {
      if (element.getAttribute("aria-label")?.trim()) return true;
      if (labelledBy(element)) return true;
      if (element instanceof HTMLInputElement && element.type === "hidden") return true;
      if ("labels" in element && element.labels?.length) return true;
      if ((element.textContent || "").trim()) return true;
      if (element.getAttribute("title")?.trim()) return true;
      if (element.querySelector("img[alt]")?.getAttribute("alt")?.trim()) return true;
      return false;
    };
    const interactive = [...document.querySelectorAll("a,button,input,select,textarea,summary")]
      .filter((element) => !(element instanceof HTMLInputElement && element.type === "hidden"))
      .filter((element) => element.getClientRects().length > 0);
    const unnamed = interactive.filter((element) => !accessibleName(element));
    const tiny = interactive.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
    });
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      h1: document.querySelectorAll("h1").length,
      primary: primaryStyle ? { color: primaryStyle.color, background: primaryStyle.backgroundColor } : null,
      theme: document.documentElement.getAttribute("data-theme"),
      forced: window.matchMedia("(forced-colors: active)").matches,
      lang: document.documentElement.lang,
      title: document.title.trim(),
      main: document.querySelectorAll("main").length,
      imagesNoAlt: [...document.images].filter((image) => !image.hasAttribute("alt")).length,
      unnamed: unnamed.map((element) => ({
        tag: element.tagName.toLowerCase(),
        cls: String(element.className).slice(0, 40),
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30),
      })),
      tinyTargets: tiny.length,
    };
  });
}

// Discover the two detail pages from their indexes so the audit does not hard-code a slug.
let articlePath = null;
let newsPath = null;
{
  const { context, page } = await open(1440);
  await page.goto(`${base}/zh/research`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  articlePath = await page.locator("a[href*='/zh/research/']").first().getAttribute("href").catch(() => null);
  await page.goto(`${base}/zh/news`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  newsPath = await page.locator("a[href*='/zh/news/']").first().getAttribute("href").catch(() => null);
  await context.close();
}

const pages = [
  ["home", "/zh"],
  ["research", "/zh/research"],
  ...(articlePath ? [["article", articlePath]] : []),
  ["news", "/zh/news"],
  ...(newsPath ? [["news-detail", newsPath]] : []),
  ["methodology", "/zh/methodology"],
  ["signin", "/signin"],
];

// 320/390/768/981/1280/1440 plus 640 for the 200%-at-1280 reflow case.
for (const [name, path] of pages) {
  for (const width of [320, 390, 640, 768, 981, 1280, 1440]) {
    for (const dark of [false, true]) {
      const { context, page } = await open(width, { dark });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(150);
      const metrics = await measure(page);
      if (metrics.overflow) fail(`${name} ${width}${dark ? " dark" : ""}: overflow ${metrics.scroll}/${metrics.client}`);
      if (metrics.h1 !== 1) fail(`${name} ${width}${dark ? " dark" : ""}: expected one h1, found ${metrics.h1}`);
      if (errors.length) fail(`${name} ${width}${dark ? " dark" : ""}: page error ${errors[0].slice(0, 80)}`);
      if (!metrics.lang) fail(`${name}: missing html lang`);
      if (!metrics.title) fail(`${name}: missing document title`);
      if (metrics.main !== 1) fail(`${name}: expected one main landmark, found ${metrics.main}`);
      if (metrics.imagesNoAlt) fail(`${name}: ${metrics.imagesNoAlt} image(s) without an alt attribute`);
      if (metrics.unnamed.length) {
        const first = metrics.unnamed[0];
        fail(`${name}: ${metrics.unnamed.length} interactive element(s) without an accessible name (first: ${first.tag} "${first.text}")`);
      }
      if (metrics.tinyTargets) note(`${name}: ${metrics.tinyTargets} interactive target(s) under 24px at ${width}px (WCAG 2.5.8 inline exception may apply)`);
      if (metrics.primary) {
        const ratio = contrast(rgb(metrics.primary.color), rgb(metrics.primary.background));
        if (ratio < 4.5) fail(`${name} ${width}${dark ? " dark" : ""}: primary contrast ${ratio.toFixed(2)}`);
      }
      await context.close();
    }
  }
}

// Theme persistence through a reload.
{
  const { context, page } = await open(1440);
  await page.goto(`${base}/zh`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(150);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (theme !== "dark") fail(`theme: expected dark after reload, got ${theme}`);
  await context.close();
}

// Input focus must be a visible 2px ring, not a transparent shadow.
{
  const { context, page } = await open(1440);
  await page.goto(`${base}/signin`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  const input = page.locator("input[type=email]").first();
  await input.focus();
  const focus = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
  });
  if (focus.width !== "2px" || focus.style === "none") fail(`focus ring: ${focus.width} ${focus.style}`);
  await context.close();
}

// axe-core: the WCAG A/AA rule set on a representative desktop-light and phone-dark run.
for (const [name, path] of pages) {
  for (const [width, dark] of [[1440, false], [390, true]]) {
    const { context, page } = await open(width, { dark });
    await page.goto(base + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(150);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
      }));
    });
    for (const violation of violations) {
      fail(`axe ${name} ${width}${dark ? " dark" : ""}: ${violation.id} (${violation.impact}, ${violation.nodes} node(s): ${violation.targets.join(", ")})`);
    }
    await context.close();
  }
}

// Optional authenticated console checks. Set ADMIN_COOKIE to a local signed session;
// the token is never printed or persisted by this script.
if (adminCookie) {
  const adminPaths = [
    "/admin", "/admin/design-system", "/admin/analytics", "/admin/analytics/behavior",
    "/admin/analytics/bots", "/admin/review", "/admin/news", "/admin/sources",
    "/admin/data", "/admin/jobs", "/admin/social", "/admin/users", "/admin/models",
    "/admin/mcp", "/admin/dashboards", "/admin/audit",
  ];
  for (const width of [390, 768, 1440]) {
    const { context, page } = await open(width, { admin: true });
    for (const path of adminPaths) {
      await page.goto(base + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(120);
      const metrics = await measure(page);
      if (metrics.overflow) fail(`admin ${path} ${width}: overflow ${metrics.scroll}/${metrics.client}`);
      if (metrics.h1 !== 1) fail(`admin ${path} ${width}: expected one h1, found ${metrics.h1}`);
    }
    await context.close();
  }
  for (const [width, dark] of [[1440, false], [390, true]]) {
    const { context, page } = await open(width, { dark, admin: true });
    for (const path of ["/admin/design-system", "/admin/analytics/behavior", "/admin/analytics/bots", "/admin/models", "/admin/social", "/admin/mcp", "/admin/news"]) {
      await page.goto(base + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(120);
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
      });
      for (const violation of violations) {
        fail(`axe admin ${path} ${width}${dark ? " dark" : ""}: ${violation.id} (${violation.impact}, ${violation.nodes} node(s): ${violation.targets.join(", ")})`);
      }
    }
    await context.close();
  }
} else {
  note("admin pages skipped: set ADMIN_COOKIE to a local signed session to include them");
}

// Forced-colors rendering is a separate OS mode; check the shell and key pages there.
for (const width of [390, 1440]) {
  for (const path of ["/zh", "/zh/research", "/signin"]) {
    const { context, page } = await open(width, { forcedColors: true });
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(150);
    const metrics = await measure(page);
    if (!metrics.forced) notes.push(`forced-colors not active for ${path} at ${width}`);
    if (metrics.overflow) fail(`forced-colors ${path} ${width}: overflow ${metrics.scroll}/${metrics.client}`);
    if (metrics.h1 !== 1) fail(`forced-colors ${path} ${width}: expected one h1, found ${metrics.h1}`);
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify({
  base,
  pages: pages.map(([name, path]) => ({ name, path })),
  admin: Boolean(adminCookie),
  failures,
  notes,
}, null, 2));
if (failures.length) process.exitCode = 1;
