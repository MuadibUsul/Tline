"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const refresh = setInterval(() => router.refresh(), 60_000); // pick up newly published values / analysis
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [router]);

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
  const name = (r: (typeof items)[number]) => (zh ? r.titleZh ?? r.titleEn : r.titleEn);
  const released = (r: (typeof items)[number]) => r.actual !== null;
  const change = focal.actual !== null && focal.previous !== null ? focal.actual - focal.previous : null;
  const live = now >= focal.sched - WIN && now <= activeEnd(focal);

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
      <a className={`spot-focal ${live ? "spot-live" : ""}`} href={`${localePrefix}/macro/release/${focal.id}`}>
        <div className="spot-eyebrow">
          <span>{focal.countryCode} · {"●".repeat(focal.importance)}</span>
          <span className={`spot-status ${live ? "on" : ""}`}>{live ? (zh ? "聚焦中" : "LIVE") : released(focal) ? (zh ? "已公布" : "released") : (zh ? "即将公布" : "upcoming")}</span>
        </div>
        <h2 className="spot-name">{name(focal)}</h2>
        {released(focal) ? (
          <div className="spot-figure">
            <span className="spot-actual">{focal.actual}</span>
            <span className="spot-unit">{focal.unit}</span>
            {change !== null && <span className={`spot-chg ${change >= 0 ? "up" : "down"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}</span>}
            <span className="spot-prev">{zh ? "前值" : "prev"} {focal.previous ?? "—"}{focal.consensus !== null ? ` · ${zh ? "机构预期" : "cons."} ${focal.consensus}${focal.consensusCount ? ` (${focal.consensusCount}${zh ? "家" : ""})` : ""}` : ""}</span>
          </div>
        ) : (
          <div className="spot-figure">
            <span className="spot-countdown">{countdown(focal.sched, now, zh)}</span>
            <span className="spot-prev">{beijing(focal.scheduledAt, zh)} · {zh ? "前值" : "prev"} {focal.previous ?? "—"}{focal.consensus !== null ? ` · ${zh ? "机构预期" : "cons."} ${focal.consensus}${focal.consensusCount ? ` (${focal.consensusCount}${zh ? "家" : ""})` : ""}` : ""}</span>
          </div>
        )}
        <p className="spot-analysis">{focal.analysis
          ? focal.analysis
          : released(focal)
            ? (zh ? "解读生成中……" : "Analysis generating…")
            : (zh ? "数据公布后将自动生成专业解读。" : "A professional read-out is generated automatically on release.")}</p>
      </a>
      {flank(next, "next")}

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
        @media(hover:hover) and (pointer:fine){.spot-focal:hover{transform:translateY(-5px);border-color:color-mix(in srgb,var(--accent) 52%,var(--border))}}
        @media(prefers-reduced-motion:reduce){.spot-focal::before,.spot-status.on{animation:none}}
        @media(min-width:820px){.spotlight{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
