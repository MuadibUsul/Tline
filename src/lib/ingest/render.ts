import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const UA = "InstitutionalIntelligenceBot/0.1 (+respectful research aggregator; contact: ops@globalintel.io)";

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const BLOCKED_PAGE = /captcha|verify you are human|access denied|unusual traffic|enable cookies to continue|sign in to continue|log in to continue|subscription required/i;
const CONSENT_GATE = /view as guest|these cookies are necessary for the website to function|confirm.{0,80}professional investor/i;
const renderReasons = new Map<string, string>();

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
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();
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
    const visible = (await page.locator("body").innerText({ timeout: 3000 })).slice(0, 4000);
    if (BLOCKED_PAGE.test(visible) || BLOCKED_PAGE.test(await page.title())) {
      renderReasons.set(url, "access wall or human verification");
      return null;
    }
    if (CONSENT_GATE.test(visible)) {
      renderReasons.set(url, "interactive consent or guest-access gate");
      return null;
    }
    return await page.content();
  } catch {
    renderReasons.set(url, "public page rendering failed");
    return null;
  } finally {
    await browser.close();
  }
}
