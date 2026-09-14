import { readFileSync } from "node:fs";
import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// Node runtime, not edge: the bundled fonts are read from disk. In the edge runtime
// `fetch(new URL(...))` resolves the asset to a file:// URL, which the runtime's fetch
// does not implement, so every card 500'd in the production build.
export const runtime = "nodejs";

const loadFont = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url));
const notoRegular = loadFont("NotoSansSC-Regular.ttf");
const notoBold = loadFont("NotoSansSC-Bold.ttf");

// A CJK glyph is about twice as wide as a Latin one, so measure the title in weighted
// units and step the size down as it grows. This keeps a long Chinese headline to about
// three lines without overflowing the card or crowding the institution line beneath it.
function titleFontSize(title: string) {
  const units = [...title].reduce((sum, char) => sum + (char.charCodeAt(0) < 0x2e80 ? 1 : 2), 0);
  if (units <= 34) return 66;
  if (units <= 52) return 56;
  if (units <= 72) return 48;
  return 42;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const clean = (value: string, fallback: string) => value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() || fallback;
  const title = clean(query.get("title") || SITE_NAME, SITE_NAME).slice(0, 90);
  const eyebrow = clean(query.get("kind") || "Institutional Intelligence", "Institutional Intelligence").slice(0, 50);
  const subtitle = clean(query.get("subtitle") || "Research / Data / Consensus / Signal", "Research / Data / Consensus / Signal").slice(0, 140);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: "#0c0e13", color: "#e8eaee", fontFamily: "Noto Sans SC, sans-serif" }}>
      <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, color: "#9db1ff", textTransform: "uppercase" }}>{eyebrow}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}><div style={{ display: "flex", fontSize: titleFontSize(title), lineHeight: 1.2, fontWeight: 700, letterSpacing: -0.5 }}>{title}</div><div style={{ display: "flex", fontSize: 28, color: "#b4bac5" }}>{subtitle}</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 25 }}><div style={{ display: "flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, background: "#e8eaee", color: "#0c0e13", fontWeight: 700 }}>II</div>{SITE_NAME}</div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Noto Sans SC", data: notoRegular, weight: 400 },
        { name: "Noto Sans SC", data: notoBold, weight: 700 },
      ],
      headers: { "cache-control": "public, max-age=86400, immutable" },
    },
  );
}
