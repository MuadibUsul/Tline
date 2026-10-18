/**
 * User-agent classification, by hand.
 *
 * A parsing library for this is tens of thousands of regular expressions maintained to
 * distinguish devices nobody in this audience uses. Four device buckets, six browsers and
 * six platforms is what the dashboard actually renders, and the cost of getting an
 * obscure agent slightly wrong is one row filed as "Other".
 *
 * The audience question is now broader than "human or bot": search crawlers, AI training /
 * assistant agents and browser automation are operationally different, and an agent that
 * renders a page is not a reader. The classes here feed a separate request table, so a
 * crawler never has to be counted as an audience member to be visible in the console.
 */

export type Device = "desktop" | "mobile" | "tablet";
export type TrafficClass = "human" | "crawler" | "ai_agent" | "automation" | "unknown";

export interface AgentInfo {
  device: Device;
  os: string;
  browser: string;
  bot: boolean;
  trafficClass: TrafficClass;
  /** A readable agent name for the console ("GPTBot", "Googlebot", "Playwright"). */
  agentName: string | null;
  /** How sure the UA-based classification is; client signals can raise automation. */
  confidence: number;
}

/** Named AI / assistant crawlers. Order matters: they are also generic "bots". */
const AI_AGENTS: Array<[RegExp, string]> = [
  [/gptbot/i, "GPTBot"],
  [/oai-searchbot/i, "OAI-SearchBot"],
  [/chatgpt-user/i, "ChatGPT-User"],
  [/claudebot/i, "ClaudeBot"],
  [/claude-web|claude-user|anthropic-ai/i, "Claude"],
  [/perplexitybot/i, "PerplexityBot"],
  [/perplexity-user/i, "Perplexity-User"],
  [/ccbot/i, "CCBot"],
  [/bytespider/i, "Bytespider"],
  [/amazonbot/i, "Amazonbot"],
  [/applebot/i, "Applebot"],
  [/google-extended/i, "Google-Extended"],
  [/meta-externalagent|facebookbot/i, "Meta-ExternalAgent"],
  [/cohere-ai/i, "Cohere"],
  [/diffbot/i, "Diffbot"],
  [/youbot/i, "YouBot"],
  [/imagesiftbot/i, "ImagesiftBot"],
  [/omgilibot|omgili/i, "Omgili"],
  [/timpibot/i, "TimpiBot"],
  [/velenpublicwebcrawler/i, "Velen"],
  [/webzio/i, "Webz.io"],
  [/friendlycrawler/i, "FriendlyCrawler"],
  [/mistralai|huggingface/i, "Mistral/HuggingFace"],
];

/** Search engines and social/link previews. Different from an AI training agent. */
const CRAWLERS: Array<[RegExp, string]> = [
  [/googlebot/i, "Googlebot"],
  [/bingbot/i, "Bingbot"],
  [/slurp/i, "Yahoo Slurp"],
  [/duckduckbot/i, "DuckDuckBot"],
  [/baiduspider/i, "Baiduspider"],
  [/yandex/i, "YandexBot"],
  [/sogou/i, "Sogou"],
  [/exabot/i, "Exabot"],
  [/ia_archiver/i, "Internet Archive"],
  [/semrush/i, "Semrush"],
  [/ahrefs/i, "Ahrefs"],
  [/mj12/i, "Majestic"],
  [/dotbot/i, "DotBot"],
  [/petalbot/i, "PetalBot"],
  [/dataforseo/i, "DataForSEO"],
  [/mediapartners/i, "Google AdSense"],
  [/facebookexternalhit/i, "Facebook preview"],
  [/embedly/i, "Embedly"],
  [/quora link preview/i, "Quora preview"],
  [/pinterest/i, "Pinterest"],
  [/bitlybot/i, "Bitly"],
  [/vkshare/i, "VK preview"],
  [/w3c_validator/i, "W3C validator"],
  [/whatsapp/i, "WhatsApp preview"],
  [/telegram/i, "Telegram preview"],
  [/discord/i, "Discord preview"],
  [/lighthouse|pagespeed|gtmetrix/i, "Lighthouse"],
  [/monitoring|uptime|pingdom/i, "Uptime monitor"],
];

/** Browser automation and HTTP clients. These are not crawlers but they are not readers. */
const AUTOMATION: Array<[RegExp, string]> = [
  [/headlesschrome/i, "Headless Chrome"],
  [/playwright/i, "Playwright"],
  [/puppeteer/i, "Puppeteer"],
  [/selenium|webdriver/i, "Selenium/WebDriver"],
  [/phantomjs/i, "PhantomJS"],
  [/curl\//i, "curl"],
  [/wget/i, "wget"],
  [/python-requests|python-urllib|aiohttp|httpx/i, "Python HTTP client"],
  [/axios\//i, "axios"],
  [/node-fetch|undici/i, "Node HTTP client"],
  [/okhttp/i, "OkHttp"],
  [/java\//i, "Java HTTP client"],
  [/go-http-client/i, "Go HTTP client"],
  [/libwww-perl/i, "libwww-perl"],
  [/apache-httpclient/i, "Apache HttpClient"],
  [/postman/i, "Postman"],
  [/insomnia/i, "Insomnia"],
  [/scrapy/i, "Scrapy"],
];

const GENERIC_BOT = /bot|crawler|spider|crawl|slurp|preview|scrape|monitor/i;
const TABLET = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i;
const MOBILE = /mobi|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/i;

function firstMatch(patterns: Array<[RegExp, string]>, ua: string): string | null {
  return patterns.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

function classifyAgent(ua: string): { trafficClass: TrafficClass; agentName: string | null; confidence: number } {
  const ai = firstMatch(AI_AGENTS, ua);
  if (ai) return { trafficClass: "ai_agent", agentName: ai, confidence: 0.98 };
  const crawler = firstMatch(CRAWLERS, ua);
  if (crawler) return { trafficClass: "crawler", agentName: crawler, confidence: 0.95 };
  const automation = firstMatch(AUTOMATION, ua);
  if (automation) return { trafficClass: "automation", agentName: automation, confidence: 0.95 };
  if (GENERIC_BOT.test(ua)) return { trafficClass: "crawler", agentName: "Other crawler", confidence: 0.7 };
  if (/mozilla|opera|safari|chrome|firefox|edg/i.test(ua)) return { trafficClass: "human", agentName: null, confidence: 0.9 };
  return { trafficClass: "unknown", agentName: "Unknown client", confidence: 0.3 };
}

export function classify(userAgent: string | null | undefined): AgentInfo {
  const ua = userAgent ?? "";
  if (!ua.trim()) {
    return { device: "desktop", os: "Unknown", browser: "Unknown", bot: true, trafficClass: "unknown", agentName: "Empty UA", confidence: 1 };
  }
  const agent = classifyAgent(ua);
  if (agent.trafficClass !== "human") {
    return { device: "desktop", os: "Bot", browser: "Bot", bot: true, ...agent };
  }

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

  return { device, os, browser, bot: false, ...agent };
}

export function isBot(userAgent: string | null | undefined): boolean {
  return classify(userAgent).trafficClass !== "human";
}

export interface ClientSignals {
  webdriver?: unknown;
  headless?: unknown;
  languages?: unknown;
  plugins?: unknown;
  hardwareConcurrency?: unknown;
  deviceMemory?: unknown;
  uaBrands?: unknown;
  touch?: unknown;
  scrollEvents?: unknown;
  pointerEvents?: unknown;
}

/**
 * Combine the server's UA verdict with signals only a browser can report.
 *
 * A page that runs JavaScript can still be a Playwright test, a screenshot service or an
 * agent embedding a browser. Navigator flags raise an otherwise-human UA to automation;
 * they never turn a known crawler into a human. The absence of interaction is deliberately
 * not used here — a real reader may scroll nothing and still be a reader.
 */
export function classifyWithSignals(ua: string | null | undefined, signals: ClientSignals | undefined): AgentInfo {
  const base = classify(ua);
  if (base.trafficClass !== "human" || !signals) return base;
  if (signals.webdriver === true) {
    return { ...base, bot: true, trafficClass: "automation", agentName: "WebDriver", confidence: 0.99 };
  }
  if (signals.headless === true) {
    return { ...base, bot: true, trafficClass: "automation", agentName: "Headless browser", confidence: 0.95 };
  }
  return base;
}
