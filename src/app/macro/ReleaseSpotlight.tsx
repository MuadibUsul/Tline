"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type SpotlightRelease = {
  id: string;
  titleEn: string;
  titleZh: string | null;
  countryCode: string;
  importance: number;
  scheduledAt: string;
  releasedAt: string | null;
  status: string;
  actual: number | null;
  previous: number | null;
  consensus: number | null;
  consensusCount: number;
  unit: string;
  analysis: string | null;
};

const WIN = 15 * 60 * 1000; // magnify window: 15 min before → 15 min after release
const POPUP_TTL = 3 * 60 * 1000; // auto-dissolve an unclosed read-out popup after 3 minutes
const DISSOLVE_MS = 1100; // length of the dissolve animation before the node is removed
const SHOWN_KEY = "spotlight-readout-shown-v1"; // release ids whose popup was already surfaced

function beijing(iso: string, zh: boolean) {
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Shanghai", weekday: "short", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function countdown(targetMs: number, now: number, zh: boolean) {
  const diff = targetMs - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h ? `${h}${zh ? "小时" : "h"}${m}${zh ? "分" : "m"}` : `${m}${zh ? "分" : "m"}`;
  return diff > 0 ? (zh ? `距公布 ${span}` : `in ${span}`) : (zh ? `${span}前公布` : `${span} ago`);
}

export default function ReleaseSpotlight({ releases, locale, initialNow }: { releases: SpotlightRelease[]; locale: string; initialNow: number }) {
  const zh = locale === "zh-CN";
  // The address carries the language, so links from here must keep it.
  const localePrefix = zh ? "/zh" : "/en";
  const router = useRouter();
  const [now, setNow] = useState(initialNow);
  // The read-out popup: the release it belongs to, and whether it is mid-dissolve.
  const [popup, setPopup] = useState<SpotlightRelease | null>(null);
  const [dissolving, setDissolving] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const refresh = setInterval(() => router.refresh(), 15_000); // pick up newly published values / analysis promptly
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [router]);

  // Releases already analysed when the page loaded (so an old print does not pop on arrival),
  // and the ids whose popup has already been shown or dismissed (persisted, so a refresh or a
  // reload does not surface the same read-out twice).
  const baselineRef = useRef<Set<string> | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  // Watch for a release that gains its value + read-out while the user is here, and pop it.
  useEffect(() => {
    if (baselineRef.current === null) {
      try { shownRef.current = new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || "[]") as string[]); } catch { /* private mode / disabled storage */ }
      baselineRef.current = new Set(releases.filter((r) => now >= new Date(r.scheduledAt).getTime() && r.actual !== null && r.analysis).map((r) => r.id));
      return; // never pop on the very first pass — only for prints that land while watching
    }
    if (popup) return;
    const fresh = releases
      .filter((r) => now >= new Date(r.scheduledAt).getTime() && r.actual !== null && r.analysis && !baselineRef.current!.has(r.id) && !shownRef.current.has(r.id))
      .sort((a, b) => new Date(b.releasedAt ?? b.scheduledAt).getTime() - new Date(a.releasedAt ?? a.scheduledAt).getTime())[0];
    if (!fresh) return;
    shownRef.current.add(fresh.id);
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shownRef.current])); } catch { /* ignore */ }
    setDissolving(false);
    setPopup(fresh);
  }, [releases, popup, now]);

  // Manual close and the 3-minute timeout both run the same dissolve, then drop the node.
  function closePopup() {
    setDissolving(true);
    setTimeout(() => { setPopup(null); setDissolving(false); }, DISSOLVE_MS);
  }
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(closePopup, POPUP_TTL);
    return () => clearTimeout(timer);
  }, [popup]);

  const items = releases
    .map((r) => ({ ...r, sched: new Date(r.scheduledAt).getTime(), rel: r.releasedAt ? new Date(r.releasedAt).getTime() : null }))
    .sort((a, b) => a.sched - b.sched);
  if (!items.length) return null;

  const activeEnd = (r: (typeof items)[number]) => (r.rel ?? r.sched) + WIN;
  const active = items.filter((r) => now >= r.sched - WIN && now <= activeEnd(r));
  const upcoming = items.filter((r) => r.sched > now);
  let focalIdx: number;
  if (active.length) focalIdx = items.indexOf(active.reduce((a, b) => (Math.abs(a.sched - now) <= Math.abs(b.sched - now) ? a : b)));
  else if (upcoming.length) focalIdx = items.indexOf(upcoming[0]);
  else focalIdx = items.length - 1;

  const focal = items[focalIdx];
  const recent = items[focalIdx - 1] ?? null;
  const next = items[focalIdx + 1] ?? null;
  const name = (r: SpotlightRelease) => (zh ? r.titleZh ?? r.titleEn : r.titleEn);
  // Never reveal a result before its scheduled publication time, even if it was ingested early.
  const released = (r: SpotlightRelease) => now >= new Date(r.scheduledAt).getTime() && r.actual !== null;
  const live = now >= focal.sched - WIN && now <= activeEnd(focal);
  // The value is final and the read-out is written: the analysis moves to the side of the card.
  const sideAnalysis = released(focal) && Boolean(focal.analysis);

  const prevLine = (r: SpotlightRelease) =>
    `${zh ? "前值" : "prev"} ${r.previous ?? "—"}${r.consensus !== null ? ` · ${zh ? "机构预期" : "cons."} ${r.consensus}${r.consensusCount ? ` (${r.consensusCount}${zh ? "家" : ""})` : ""}` : ""}`;

  const figure = (r: SpotlightRelease) => {
    const chg = r.actual !== null && r.previous !== null ? r.actual - r.previous : null;
    return (
      <div className="spot-figure">
        <span className="spot-actual">{r.actual}</span>
        <span className="spot-unit">{r.unit}</span>
        {chg !== null && <span className={`spot-chg ${chg >= 0 ? "up" : "down"}`}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}</span>}
        <span className="spot-prev">{prevLine(r)}</span>
      </div>
    );
  };

  const flank = (r: (typeof items)[number] | null, side: string) =>
    r && (
      <a className={`spot-flank spot-${side}`} href={`${localePrefix}/macro/release/${r.id}`}>
        <div className="spot-flank-top">{r.countryCode} · {"●".repeat(r.importance)}</div>
        <div className="spot-flank-name">{name(r)}</div>
        <div className="spot-flank-meta">
          <span>{beijing(r.scheduledAt, zh)}</span>
          <span className="spot-val">{released(r) ? r.actual : countdown(r.sched, now, zh)}</span>
        </div>
      </a>
    );

  return (
    <section className="spotlight" aria-label={zh ? "重点数据聚焦" : "Data spotlight"}>
      {flank(recent, "recent")}
      <a className={`spot-focal ${live ? "spot-live" : ""} ${sideAnalysis ? "spot-split" : ""}`} href={`${localePrefix}/macro/release/${focal.id}`}>
        <div className="spot-lead">
          <div className="spot-eyebrow">
            <span>{focal.countryCode} · {"●".repeat(focal.importance)}</span>
            <span className={`spot-status ${live ? "on" : ""}`}>{live ? (zh ? "聚焦中" : "LIVE") : released(focal) ? (zh ? "已公布" : "released") : (zh ? "即将公布" : "upcoming")}</span>
          </div>
          <h2 className="spot-name">{name(focal)}</h2>
          {released(focal) ? figure(focal) : (
            <div className="spot-figure">
              <span className="spot-countdown">{countdown(focal.sched, now, zh)}</span>
              <span className="spot-prev">{beijing(focal.scheduledAt, zh)} · {prevLine(focal)}</span>
            </div>
          )}
          {!sideAnalysis && (
            <p className="spot-analysis">{released(focal)
              ? (zh ? "解读生成中……" : "Analysis generating…")
              : (zh ? "数据公布后将自动生成专业解读。" : "A professional read-out is generated automatically on release.")}</p>
          )}
        </div>
        {sideAnalysis && (
          <div className="spot-side">
            <div className="spot-side-t">{zh ? "AI 专业解读" : "AI read-out"}</div>
            <p className="spot-analysis">{focal.analysis}</p>
          </div>
        )}
      </a>
      {flank(next, "next")}

      {popup && (
        <div className={`spot-pop-back ${dissolving ? "dissolve" : ""}`} onClick={closePopup} role="dialog" aria-modal="true" aria-label={zh ? "数据公布解读" : "Release read-out"}>
          <div className={`spot-pop ${dissolving ? "dissolve" : ""}`} onClick={(e) => e.stopPropagation()}>
            <button className="spot-pop-x" onClick={closePopup} aria-label={zh ? "关闭" : "Close"}>×</button>
            <div className="spot-eyebrow">
              <span>{popup.countryCode} · {"●".repeat(popup.importance)}</span>
              <span className="spot-status on">{zh ? "刚刚公布" : "just released"}</span>
            </div>
            <h2 className="spot-name">{name(popup)}</h2>
            {figure(popup)}
            <div className="spot-pop-t">{zh ? "AI 专业解读" : "AI read-out"}</div>
            <p className="spot-pop-analysis">{popup.analysis}</p>
            <a className="spot-pop-link" href={`${localePrefix}/macro/release/${popup.id}`}>{zh ? "查看发布详情 ↗" : "Open release detail ↗"}</a>
            <div className="spot-pop-hint">{zh ? "3 分钟后自动关闭" : "Closes on its own after 3 minutes"}</div>
          </div>
        </div>
      )}

      <style>{`
        .spotlight{display:grid;grid-template-columns:1fr;gap:10px;margin:8px 0 0}
        .spot-flank{display:block;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--panel);opacity:.5;text-decoration:none;transition:opacity .3s;filter:saturate(.7)}
        .spot-flank:hover{opacity:.85}
        .spot-recent{opacity:.42}
        .spot-flank-top{font:10px var(--mono);color:var(--faint);letter-spacing:1px}
        .spot-flank-name{font:600 14px var(--sans);color:var(--ink-2);margin:3px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .spot-flank-meta{display:flex;justify-content:space-between;font:11px var(--mono);color:var(--muted)}
        .spot-flank-meta .spot-val{color:var(--ink)}
        .spot-focal{position:relative;display:block;padding:22px 24px;border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border));border-radius:14px;background:linear-gradient(135deg,color-mix(in srgb,var(--panel) 96%,var(--accent)),var(--panel) 48%);text-decoration:none;transform:translateY(-3px);box-shadow:0 18px 45px rgba(0,0,0,.22),0 0 32px color-mix(in srgb,var(--accent) 14%,transparent);transition:transform 180ms cubic-bezier(.23,1,.32,1),border-color 180ms ease}
        .spot-focal::before{content:"";position:absolute;inset:-1px;border-radius:inherit;pointer-events:none;box-shadow:0 0 20px color-mix(in srgb,var(--accent) 22%,transparent),0 0 64px color-mix(in srgb,var(--accent) 12%,transparent);opacity:.62;animation:spotglow 5s ease-in-out infinite}
        .spot-focal::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,color-mix(in srgb,#fff 8%,transparent),transparent 24%,transparent 72%,color-mix(in srgb,var(--accent) 7%,transparent))}
        .spot-focal.spot-live{border-color:color-mix(in srgb,var(--accent) 72%,white);box-shadow:0 20px 52px rgba(0,0,0,.25),0 0 42px color-mix(in srgb,var(--accent) 26%,transparent)}
        .spot-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:26px;align-items:start}
        .spot-side{position:relative;z-index:1;border-left:1px solid color-mix(in srgb,var(--accent) 26%,var(--border));padding-left:22px}
        .spot-side-t,.spot-pop-t{font:11px var(--mono);letter-spacing:1px;color:var(--accent-ink);text-transform:uppercase}
        .spot-side .spot-analysis{margin:8px 0 0}
        @keyframes spotglow{0%,100%{opacity:.48}50%{opacity:.9}}
        .spot-eyebrow{display:flex;justify-content:space-between;align-items:center;font:10.5px var(--mono);color:var(--faint);letter-spacing:1px}
        .spot-status{padding:2px 9px;border:1px solid var(--border);border-radius:99px;color:var(--muted)}
        .spot-status.on{background:var(--accent);border-color:var(--accent);color:#fff;animation:spotpulse 2s ease-in-out infinite}
        @keyframes spotpulse{0%,100%{opacity:1}50%{opacity:.55}}
        .spot-name{font:600 22px/1.3 var(--sans);color:var(--ink);margin:10px 0 12px}
        .spot-figure{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px}
        .spot-actual{font:700 40px var(--mono);letter-spacing:-.02em;color:var(--ink)}
        .spot-countdown{font:700 30px var(--mono);color:var(--accent-ink)}
        .spot-unit{font:13px var(--mono);color:var(--muted)}
        .spot-chg{font:600 15px var(--mono)}.spot-chg.up{color:var(--bull)}.spot-chg.down{color:var(--bear)}
        .spot-prev{font:12px var(--mono);color:var(--faint)}
        .spot-analysis{margin:14px 0 0;font:14px/1.7 var(--sans);color:var(--ink-2)}
        .spot-pop-back{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,#05070c 62%,transparent);backdrop-filter:blur(4px);animation:spotFade .28s ease}
        .spot-pop{position:relative;width:min(560px,100%);max-height:min(80vh,680px);overflow:auto;padding:24px 26px;border:1px solid color-mix(in srgb,var(--accent) 42%,var(--border));border-radius:16px;background:var(--panel);box-shadow:0 34px 90px rgba(0,0,0,.55),0 0 48px color-mix(in srgb,var(--accent) 22%,transparent);animation:spotRise .34s cubic-bezier(.2,1,.3,1)}
        .spot-pop-back.dissolve{animation:spotFade .9s ease forwards reverse}
        .spot-pop.dissolve{animation:spotDissolve ${DISSOLVE_MS}ms ease forwards}
        .spot-pop-x{position:absolute;top:12px;right:14px;width:30px;height:30px;border:1px solid var(--border);border-radius:99px;background:var(--panel);color:var(--muted);font:18px/1 var(--sans);cursor:pointer;transition:color .2s,border-color .2s}
        .spot-pop-x:hover{color:var(--ink);border-color:var(--accent)}
        .spot-pop-t{margin:18px 0 0}
        .spot-pop-analysis{margin:8px 0 0;font:14px/1.75 var(--sans);color:var(--ink-2)}
        .spot-pop-link{display:inline-block;margin:16px 0 0;font:12px var(--mono);color:var(--accent-ink);text-decoration:none}
        .spot-pop-hint{margin-top:10px;font:11px var(--mono);color:var(--faint)}
        @keyframes spotFade{from{opacity:0}to{opacity:1}}
        @keyframes spotRise{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
        @keyframes spotDissolve{0%{opacity:1;filter:blur(0);transform:scale(1)}100%{opacity:0;filter:blur(9px);transform:scale(.95) translateY(-8px)}}
        @media(hover:hover) and (pointer:fine){.spot-focal:hover{transform:translateY(-5px);border-color:color-mix(in srgb,var(--accent) 52%,var(--border))}}
        @media(prefers-reduced-motion:reduce){.spot-focal::before,.spot-status.on,.spot-pop,.spot-pop-back{animation:none}.spot-pop.dissolve{opacity:0;transition:opacity ${DISSOLVE_MS}ms linear}}
        @media(max-width:720px){.spot-split{grid-template-columns:1fr}.spot-side{border-left:0;border-top:1px solid color-mix(in srgb,var(--accent) 26%,var(--border));padding-left:0;padding-top:16px}}
      `}</style>
    </section>
  );
}
