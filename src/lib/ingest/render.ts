import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

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
const CONSENT_GATE = /view as guest|these cookies are necessary for the website to function|confirm.{0,120}professional investor|i am a professional investor/i;
const renderReasons = new Map<string, string>();

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export function lastRenderReason(url: string): string | undefined {
  return renderReasons.get(url);
}

/** Normal public-page rendering only: no stealth, proxy rotation, CAPTCHA solving, or login. */
export async function renderHtml(url: string, timeoutMs = 25000): Promise<string | null> {
  renderReasons.delete(url);
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
      if (["image", "media", "font"].includes(type)) await route.abort();
      else await route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
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
    const visible = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 4000);
    if (BLOCKED_PAGE.test(visible) || BLOCKED_PAGE.test(await page.title())) {
      renderReasons.set(url, "access wall or human verification");
      return null;
    }
    if (CONSENT_GATE.test(visible)) {
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
