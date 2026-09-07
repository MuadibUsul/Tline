/**
 * User-agent classification, by hand.
 *
 * A parsing library for this is tens of thousands of regular expressions maintained to
 * distinguish devices nobody in this audience uses. Four device buckets, six browsers and
 * six platforms is what the dashboard actually renders, and the cost of getting an
 * obscure agent slightly wrong is one row filed as "Other".
 */

export type Device = "desktop" | "mobile" | "tablet";

export interface AgentInfo {
  device: Device;
  os: string;
  browser: string;
  bot: boolean;
}

/**
 * Anything self-identifying as automated.
 *
 * Deliberately broad. A crawler counted as a reader inflates every number on the traffic
 * dashboard, and a real reader miscounted as a crawler costs one view — the asymmetry is
 * worth erring on.
 */
const BOT = /bot|crawler|spider|crawl|slurp|mediapartners|facebookexternalhit|embedly|quora link preview|pinterest|bitlybot|vkshare|w3c_validator|whatsapp|telegram|discord|preview|scrape|curl|wget|python-requests|axios|okhttp|java\/|go-http|headless|phantomjs|lighthouse|pagespeed|gtmetrix|monitoring|uptime|pingdom|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexity|applebot|amazonbot|dataforseo/i;

const TABLET = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i;
const MOBILE = /mobi|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/i;

export function classify(userAgent: string | null | undefined): AgentInfo {
  const ua = userAgent ?? "";
  if (!ua.trim()) return { device: "desktop", os: "Unknown", browser: "Unknown", bot: true };
  if (BOT.test(ua)) return { device: "desktop", os: "Bot", browser: "Bot", bot: true };

  const device: Device = TABLET.test(ua) ? "tablet" : MOBILE.test(ua) ? "mobile" : "desktop";

  // Order matters throughout: every Chromium browser also claims to be Chrome and Safari,
  // and Edge claims to be all three, so the most specific brand has to be tested first.
  const os =
    /windows/i.test(ua) ? "Windows"
    : /iphone|ipad|ipod/i.test(ua) ? "iOS"
    : /android/i.test(ua) ? "Android"
    : /mac os x|macintosh/i.test(ua) ? "macOS"
    : /cros/i.test(ua) ? "ChromeOS"
    : /linux/i.test(ua) ? "Linux"
    : "Other";

  const browser =
    /edg[ea]?\//i.test(ua) ? "Edge"
    : /opr\/|opera/i.test(ua) ? "Opera"
    : /samsungbrowser/i.test(ua) ? "Samsung Internet"
    : /firefox|fxios/i.test(ua) ? "Firefox"
    : /chrome|crios|chromium/i.test(ua) ? "Chrome"
    : /safari/i.test(ua) ? "Safari"
    : "Other";

  return { device, os, browser, bot: false };
}

export function isBot(userAgent: string | null | undefined): boolean {
  return classify(userAgent).bot;
}
