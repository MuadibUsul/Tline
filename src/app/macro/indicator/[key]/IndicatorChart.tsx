"use client";

import { useMemo, useState } from "react";

type SeriesPoint = { period: string; value: number };
const RANGES: Array<[string, number]> = [["1Y", 1], ["3Y", 3], ["5Y", 5], ["10Y", 10], ["MAX", 0]];

// Interactive history chart in the TradingEconomics spirit: range toggle (1Y…MAX) and a
// value/change metric switch. "Value" draws an area (works for levels); "Change" draws
// period-over-period bars coloured by sign (works for flows like payrolls).
export default function IndicatorChart({ series, unit, locale }: { series: SeriesPoint[]; unit: string; locale: string }) {
  const zh = locale === "zh-CN";
  const [years, setYears] = useState(5);
  const [metric, setMetric] = useState<"value" | "chg">("value");

  const points = useMemo(() => series.map((p) => ({ t: new Date(p.period).getTime(), v: p.value })).sort((a, b) => a.t - b.t), [series]);
  const data = useMemo(() => {
    const cutoff = years ? Date.now() - years * 365.25 * 864e5 : 0;
    const ranged = points.filter((p) => p.t >= cutoff);
    if (metric === "chg") return ranged.map((p, i, arr) => ({ t: p.t, v: i ? p.v - arr[i - 1].v : 0 })).slice(1);
    return ranged;
  }, [points, years, metric]);

  const W = 720, H = 240, PL = 46, PR = 12, PT = 12, PB = 22;
  const values = data.map((d) => d.v);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const min = metric === "chg" ? Math.min(0, rawMin) : rawMin;
  const max = metric === "chg" ? Math.max(0, rawMax) : rawMax;
  const span = max - min || 1;
  const x = (i: number) => PL + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - PL - PR));
  const y = (v: number) => H - PB - ((v - min) / span) * (H - PT - PB);
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const yearLabel = (t: number) => new Date(t).getUTCFullYear();

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join(" ");
  const area = data.length ? `${line} L${x(data.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z` : "";
  const barW = data.length ? Math.max(1, (W - PL - PR) / data.length * 0.7) : 1;
  const ticks = [min, min + span / 2, max];

  return (
    <div>
      <div className="chart-controls">
        <div className="chart-ranges">
          {RANGES.map(([label, y]) => (
            <button key={label} type="button" className={`chart-btn ${years === y ? "on" : ""}`} onClick={() => setYears(y)}>{label}</button>
          ))}
        </div>
        <div className="chart-ranges">
          <button type="button" className={`chart-btn ${metric === "value" ? "on" : ""}`} onClick={() => setMetric("value")}>{zh ? "数值" : "Value"}</button>
          <button type="button" className={`chart-btn ${metric === "chg" ? "on" : ""}`} onClick={() => setMetric("chg")}>{zh ? "变化" : "Chg"}</button>
        </div>
      </div>
      <svg className="macro-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={zh ? "历史走势图" : "history chart"}>
        {data.length < 2 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--muted)" fontFamily="var(--sans)">{zh ? "本区间数据不足" : "Not enough data in range"}</text>
        )}
        {data.length >= 2 && ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={PL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--faint)" fontFamily="var(--mono)">{fmt(t)}</text>
          </g>
        ))}
        {data.length >= 2 && (metric === "value" ? (
          <>
            <path d={area} fill="var(--accent)" fillOpacity="0.1" />
            <path d={line} fill="none" stroke="var(--accent-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          data.map((d, i) => (
            <rect key={i} x={x(i) - barW / 2} width={barW} y={Math.min(y(d.v), y(0))} height={Math.abs(y(d.v) - y(0))} fill={d.v >= 0 ? "var(--bull)" : "var(--bear)"} opacity="0.9" />
          ))
        ))}
        {data.length > 1 && [0, Math.floor(data.length / 2), data.length - 1].map((i, k) => (
          <text key={k} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} fontSize="10" fill="var(--faint)" fontFamily="var(--mono)">{yearLabel(data[i].t)}</text>
        ))}
      </svg>
      <div className="chart-unit">{unit}</div>
    </div>
  );
}
