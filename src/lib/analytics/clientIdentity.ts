"use client";

import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_COOKIE_MAX_AGE,
  ANALYTICS_VISITOR_COOKIE,
} from "./cookieNames";

export type ConsentDecision = "granted" | "denied" | "unknown";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) {
      try {
        return decodeURIComponent(value.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function randomVisitorKey(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function consentDecision(): ConsentDecision {
  const value = readCookie(ANALYTICS_CONSENT_COOKIE);
  return value === "granted" || value === "denied" ? value : "unknown";
}

export function visitorKey(): string | null {
  if (consentDecision() !== "granted") return null;
  return readCookie(ANALYTICS_VISITOR_COOKIE);
}

/** Create the stable id only after consent; reuse the existing one for 180 days. */
export function ensureVisitorKey(): string | null {
  if (consentDecision() !== "granted") return null;
  const existing = readCookie(ANALYTICS_VISITOR_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing)) return existing;
  const created = randomVisitorKey();
  writeCookie(ANALYTICS_VISITOR_COOKIE, created, ANALYTICS_COOKIE_MAX_AGE);
  return created;
}

export function chooseConsent(decision: "granted" | "denied") {
  writeCookie(ANALYTICS_CONSENT_COOKIE, decision, ANALYTICS_COOKIE_MAX_AGE);
  if (decision === "granted") {
    ensureVisitorKey();
  } else {
    deleteCookie(ANALYTICS_VISITOR_COOKIE);
  }
  window.dispatchEvent(new CustomEvent("tline:consent", { detail: decision }));
}

/** Client signals for the human / automation / agent split. */
export function automationSignals() {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { webdriver?: boolean; deviceMemory?: number };
  return {
    webdriver: nav.webdriver === true,
    headless: /headless/i.test(nav.userAgent ?? ""),
    languages: Array.isArray(nav.languages) ? nav.languages.length : 0,
    plugins: typeof nav.plugins?.length === "number" ? nav.plugins.length : 0,
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 0,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : 0,
    uaBrands: Boolean((nav as Navigator & { userAgentData?: unknown }).userAgentData),
    touch: typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints > 0 : false,
  };
}
