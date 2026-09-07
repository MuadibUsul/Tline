import assert from "node:assert/strict";
import test from "node:test";
import { classify, isBot } from "./agent";

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const SAFARI_IPAD = "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("desktop, mobile and tablet are told apart", () => {
  assert.equal(classify(CHROME_WINDOWS).device, "desktop");
  assert.equal(classify(SAFARI_IPHONE).device, "mobile");
  assert.equal(classify(SAFARI_IPAD).device, "tablet");
  // Android without "Mobile" in the string is the platform's own signal for a tablet.
  assert.equal(classify(ANDROID_TABLET).device, "tablet");
});

test("a Chromium browser is reported as itself, not as Chrome or Safari", () => {
  assert.equal(classify(EDGE).browser, "Edge");
  assert.equal(classify(CHROME_WINDOWS).browser, "Chrome");
  assert.equal(classify(SAFARI_IPHONE).browser, "Safari");
  assert.equal(classify(FIREFOX_MAC).browser, "Firefox");
});

test("platforms come out of the same string", () => {
  assert.equal(classify(CHROME_WINDOWS).os, "Windows");
  assert.equal(classify(SAFARI_IPHONE).os, "iOS");
  assert.equal(classify(FIREFOX_MAC).os, "macOS");
  assert.equal(classify(ANDROID_TABLET).os, "Android");
});

test("automated callers are excluded, including the ones that dress as browsers", () => {
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isBot("curl/8.4.0"), true);
  assert.equal(isBot("node-fetch/1.0"), false); // not claimed by anything we have seen
  assert.equal(isBot("Mozilla/5.0 (compatible; ClaudeBot/1.0)"), true);
  assert.equal(isBot("Mozilla/5.0 AppleWebKit/537.36 HeadlessChrome/131.0.0.0"), true);
  assert.equal(isBot(CHROME_WINDOWS), false);
});

test("a missing user agent is treated as automated rather than as a desktop reader", () => {
  assert.equal(isBot(""), true);
  assert.equal(isBot(null), true);
});
