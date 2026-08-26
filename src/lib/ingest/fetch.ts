const UA =
  "InstitutionalIntelligenceBot/0.1 (+respectful research aggregator; contact: ops@globalintel.io)";

export async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml,*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/text|html|xml|rss|json/i.test(ct)) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
