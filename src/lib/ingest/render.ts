import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { assertPublicHttpUrl } from "./fetch";
import { isAccessGateText } from "./extract";

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const BLOCKED_PAGE = /captcha|verify you are human|access denied|unusual traffic|enable cookies to continue|sign in to continue|log in to continue|subscription required|we are sorry an error has occurred|unable to authorize your request/i;
const renderReasons = new Map<string, string>();

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export function lastRenderReason(url: string): string | undefined {
  return renderReasons.get(url);
}

/** Download a public PDF that requires the cookies/referrer of its public article page. */
export async function fetchBrowserPdf(pageUrl: string, pdfUrl: string, timeoutMs = 25000): Promise<Buffer | null> {
  await assertPublicHttpUrl(pageUrl);
  await assertPublicHttpUrl(pdfUrl);
  const executablePath = browserExecutable();
  if (!executablePath) return null;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const detector = await browser.newPage();
    const browserUa = (await detector.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
    await detector.close();
    const context = await browser.newContext({ locale: "en-US", userAgent: browserUa });
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const response = await context.request.get(pdfUrl, { headers: { referer: pageUrl }, timeout: timeoutMs });
    await assertPublicHttpUrl(response.url());
    const length = Number(response.headers()["content-length"] || 0);
    if (!response.ok() || length > 50 * 1024 * 1024) return null;
    const buffer = await response.body();
    return buffer.length <= 50 * 1024 * 1024 && buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")) ? buffer : null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

/** Save the same public print view exposed by a publisher's Print control. */
export async function renderPdf(url: string, timeoutMs = 25000): Promise<Buffer | null> {
  renderReasons.delete(url);
  await assertPublicHttpUrl(url);
  const executablePath = browserExecutable();
  if (!executablePath) return null;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const detector = await browser.newPage();
    const browserUa = (await detector.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
    await detector.close();
    const context = await browser.newContext({ locale: "en-US", userAgent: browserUa });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await assertPublicHttpUrl(page.url());
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const necessary = page.getByRole("button", { name: /^(?:only necessary cookies|ok to necessary|necessary only|reject all)$/i }).first();
    if (await necessary.isVisible().catch(() => false)) {
      await necessary.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
    const visible = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 100_000);
    if (BLOCKED_PAGE.test(visible) || isAccessGateText(visible) || BLOCKED_PAGE.test(await page.title())) {
      renderReasons.set(url, "access wall or human verification");
      return null;
    }
    // Nomura's fixed navigation is repeated over the article at every page break.
    // Its public print control has no dedicated stylesheet, so remove only that chrome.
    if (new URL(page.url()).hostname.endsWith("nomuraconnects.com")) {
      await page.locator("header").evaluateAll((headers) => headers.forEach((header) => header.remove()));
    }
    await page.emulateMedia({ media: "print" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } catch {
    renderReasons.set(url, "public page PDF rendering failed");
    return null;
  } finally {
    await browser.close();
  }
}

/** Normal public-page rendering only: no stealth, proxy rotation, CAPTCHA solving, or login. */
export async function renderHtml(url: string, timeoutMs = 25000): Promise<string | null> {
  renderReasons.delete(url);
  await assertPublicHttpUrl(url);
  const executablePath = browserExecutable();
  if (!executablePath) return null;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const detector = await browser.newPage();
    const browserUa = (await detector.evaluate(() => navigator.userAgent)).replace("HeadlessChrome", "Chrome");
    await detector.close();
    // Use Chromium's native UA for pages that explicitly require a browser.
    // The HTTP crawler remains identified; this renderer is the browser fallback.
    const context = await browser.newContext({ locale: "en-US", userAgent: browserUa });
    const page = await context.newPage();
    const origin = new URL(url).origin;
    const checkedOrigins = new Set([origin]);
    const publicJson: string[] = [];
    const captures: Promise<void>[] = [];
    let capturedBytes = 0;
    page.on("response", (response) => {
      const capture = (async () => {
        try {
          const target = new URL(response.url());
          const type = response.request().resourceType();
          const contentType = response.headers()["content-type"] || "";
          const length = Number(response.headers()["content-length"] || 0);
          if (target.origin !== origin || !["xhr", "fetch"].includes(type) || !/json/i.test(contentType) || length > 1_000_000 || publicJson.length >= 12 || capturedBytes >= 4_000_000) return;
          const body = await response.text();
          if (!body.trim() || body.length > 1_000_000 || capturedBytes + body.length > 4_000_000) return;
          JSON.parse(body);
          capturedBytes += body.length;
          publicJson.push(body.replace(/</g, "\\u003c"));
        } catch { /* not a usable public JSON response */ }
      })();
      captures.push(capture);
    });
    await page.route("**/*", async (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) return route.abort();
      try {
        const target = new URL(route.request().url());
        if (["http:", "https:"].includes(target.protocol) && !checkedOrigins.has(target.origin)) {
          await assertPublicHttpUrl(target.toString());
          checkedOrigins.add(target.origin);
        }
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await assertPublicHttpUrl(page.url());
    // Give public client-side content APIs time to settle, but cap the wait for pages
    // that keep analytics connections open indefinitely.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    // Dismiss ordinary cookie banners using the privacy-preserving option. This
    // does not accept investor classifications, terms, logins, or access walls.
    const necessary = page.getByRole("button", { name: /^(?:only necessary cookies|ok to necessary|necessary only|reject all)$/i }).first();
    if (await necessary.isVisible().catch(() => false)) {
      await necessary.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
    await Promise.allSettled(captures);
    const visible = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 100_000);
    const publicDownloads = await page.locator("a[href]").evaluateAll((anchors) => anchors.flatMap((element) => {
      const anchor = element as HTMLAnchorElement;
      const marker = `${anchor.getAttribute("aria-label") || ""} ${anchor.getAttribute("data-share-type") || ""}`;
      return anchor.hasAttribute("download") || /pdf/i.test(marker)
        ? [{ href: anchor.href, label: anchor.textContent?.trim() || marker.trim() || "Download PDF" }]
        : [];
    }));
    if (BLOCKED_PAGE.test(visible) || BLOCKED_PAGE.test(await page.title())) {
      renderReasons.set(url, "access wall or human verification");
      return null;
    }
    if (isAccessGateText(visible)) {
      // A publisher may expose a direct public document while placing an investor
      // classification prompt over the HTML preview. Keep only that declared download;
      // never answer the prompt or ingest the obscured page body.
      if (publicDownloads.length) {
        return `<html><body>${publicDownloads.map(({ href, label }) => `<a href="${escapeHtml(href)}" download>${escapeHtml(label)}</a>`).join("")}</body></html>`;
      }
      renderReasons.set(url, "interactive consent or guest-access gate");
      return null;
    }
    let html = await page.content();
    // Declarative web components keep their rendered prose in shadow DOM, which
    // page.content() omits. Preserve the public, visible main text for extraction.
    if (/<jb-[\w-]+\b/i.test(html)) {
      let mainText = (await page.locator("main").innerText().catch(() => "")).trim();
      if (!mainText) {
        const session = await page.context().newCDPSession(page);
        const tree = await session.send("Accessibility.getFullAXTree") as { nodes: Array<{ role?: { value?: string }; name?: { value?: string } }> };
        mainText = tree.nodes
          .filter((node) => ["StaticText", "heading"].includes(node.role?.value ?? ""))
          .map((node) => node.name?.value?.trim())
          .filter(Boolean)
          .join("\n");
      }
      mainText = mainText.slice(0, 200_000);
      if (mainText) {
        const rendered = `<article data-rendered-main><h1>${escapeHtml(await page.title())}</h1><p>${escapeHtml(mainText).replace(/\n+/g, "</p><p>")}</p></article>`;
        html = html.includes("</body>") ? html.replace("</body>", `${rendered}</body>`) : `${html}${rendered}`;
      }
    }
    if (publicJson.length === 0) return html;
    const state = publicJson.map((body) => `<script type="application/json" data-public-response>${body}</script>`).join("");
    return html.includes("</body>") ? html.replace("</body>", `${state}</body>`) : `${html}${state}`;
  } catch {
    renderReasons.set(url, "public page rendering failed");
    return null;
  } finally {
    await browser.close();
  }
}
