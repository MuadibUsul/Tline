import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const runtime = "edge";

const loadFont = (name: string) => fetch(new URL(`./${name}`, import.meta.url)).then((response) => response.arrayBuffer());
const notoRegular = loadFont("NotoSansSC-Regular.ttf");
const notoBold = loadFont("NotoSansSC-Bold.ttf");

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const clean = (value: string, fallback: string) => value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() || fallback;
  const title = clean(query.get("title") || SITE_NAME, SITE_NAME).slice(0, 100);
  const eyebrow = clean(query.get("kind") || "Institutional Intelligence", "Institutional Intelligence").slice(0, 50);
  const subtitle = clean(query.get("subtitle") || "Research / Data / Consensus / Signal", "Research / Data / Consensus / Signal").slice(0, 140);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px", background: "#0c0e13", color: "#e8eaee", fontFamily: "Noto Sans SC, sans-serif" }}>
      <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, color: "#9db1ff", textTransform: "uppercase" }}>{eyebrow}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}><div style={{ display: "flex", fontSize: 66, lineHeight: 1.08, fontWeight: 700 }}>{title}</div><div style={{ display: "flex", fontSize: 28, color: "#b4bac5" }}>{subtitle}</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 25 }}><div style={{ display: "flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, background: "#e8eaee", color: "#0c0e13", fontWeight: 700 }}>II</div>{SITE_NAME}</div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Noto Sans SC", data: await notoRegular, weight: 400 },
        { name: "Noto Sans SC", data: await notoBold, weight: 700 },
      ],
      headers: { "cache-control": "public, max-age=86400, immutable" },
    },
  );
}
