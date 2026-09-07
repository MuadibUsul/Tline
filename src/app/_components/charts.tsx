/**
 * Charts, drawn as SVG on the server.
 *
 * No charting library: these are four shapes, and a dependency for them would ship a
 * runtime to the browser to draw what the server can emit as markup. Everything renders
 * in the first response, works with JavaScript switched off, and takes its colours from
 * the same CSS variables as the rest of the site, so light and dark are already handled.
 */

export interface SeriesPoint {
  label: string;
  primary: number;
  secondary?: number;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 34 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  // 1 / 2 / 5 / 10 steps: any other ceiling puts axis labels on numbers nobody reads.
  const step = [1, 2, 2.5, 5, 10].find((factor) => value <= factor * magnitude) ?? 10;
  return step * magnitude;
}

function shortNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/**
 * Views and visitors over time.
 *
 * Two series on one axis: the gap between them is the story (many views per visitor means
 * people are reading on; a flat gap means they arrive and leave).
 */
export function TimeSeries({
  points,
  width = 720,
  height = 200,
  primaryLabel,
  secondaryLabel,
  bare = false,
}: {
  points: SeriesPoint[];
  width?: number;
  height?: number;
  primaryLabel: string;
  secondaryLabel?: string;
  /** Line only, no axis or legend: for a sparkline inside a table cell. */
  bare?: boolean;
}) {
  if (points.length === 0) return <div className="empty-state">—</div>;
  const max = niceMax(Math.max(1, ...points.map((point) => Math.max(point.primary, point.secondary ?? 0))));
  const pad = bare ? { top: 3, right: 2, bottom: 3, left: 2 } : PAD;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  // A single point has no span to divide by; it is drawn in the middle of the plot.
  const x = (index: number) => pad.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) => pad.top + plotH - (value / max) * plotH;

  const line = (pick: (point: SeriesPoint) => number) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(pick(point)).toFixed(1)}`).join(" ");
  const area = `${line((point) => point.primary)} L${x(points.length - 1).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;

  // At most six labels: past that they collide and the axis becomes a grey smear.
  const every = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className={`chart${bare ? " chart-bare" : ""}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="none"
        aria-label={`${primaryLabel}${secondaryLabel ? ` and ${secondaryLabel}` : ""}, ${points[0].label} to ${points.at(-1)!.label}`}>
        {!bare && [0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={y(max * fraction)} y2={y(max * fraction)} />
            <text className="chart-axis" x={pad.left - 6} y={y(max * fraction) + 3} textAnchor="end">{shortNumber(max * fraction)}</text>
          </g>
        ))}
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line((point) => point.primary)} />
        {secondaryLabel && <path className="chart-line chart-line-2" d={line((point) => point.secondary ?? 0)} />}
        {!bare && points.map((point, index) => index % every === 0 || index === points.length - 1 ? (
          <text className="chart-axis" key={point.label} x={x(index)} y={height - 6} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{point.label}</text>
        ) : null)}
      </svg>
      {!bare && <figcaption className="chart-legend">
        <span><i className="chart-key" /> {primaryLabel}</span>
        {secondaryLabel && <span><i className="chart-key chart-key-2" /> {secondaryLabel}</span>}
      </figcaption>}
    </figure>
  );
}

export interface BarRow {
  label: string;
  value: number;
  hint?: string;
  href?: string;
}

/**
 * A ranked list where the bar is the row's own background.
 *
 * Chosen over a bar chart because the labels here are page paths and hostnames: text that
 * has to stay readable at full length, which a rotated axis never manages.
 */
export function BarList({ rows, total, empty }: { rows: BarRow[]; total?: number; empty: string }) {
  if (rows.length === 0) return <div className="empty-state">{empty}</div>;
  const max = Math.max(1, total ?? Math.max(...rows.map((row) => row.value)));
  return (
    <div className="barlist">
      {rows.map((row) => (
        <div className="barlist-row" key={row.label}>
          <span className="barlist-fill" style={{ width: `${Math.max(1, (row.value / max) * 100).toFixed(1)}%` }} aria-hidden="true" />
          <span className="barlist-label">
            {row.href ? <a href={row.href}>{row.label}</a> : row.label}
            {row.hint && <small>{row.hint}</small>}
          </span>
          <span className="barlist-value tnum">{row.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/** A share-of-total ring, for a breakdown with three or four parts. */
export function Donut({ slices, size = 128 }: { slices: { label: string; value: number }[]; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <div className="empty-state">—</div>;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <figure className="donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={slices.map((slice) => `${slice.label} ${Math.round((slice.value / total) * 100)}%`).join(", ")}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((slice, index) => {
            const length = (slice.value / total) * circumference;
            const dash = <circle
              key={slice.label}
              className={`donut-slice donut-slice-${index % 4}`}
              cx={size / 2} cy={size / 2} r={radius}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />;
            offset += length;
            return dash;
          })}
        </g>
      </svg>
      <figcaption className="donut-legend">
        {slices.map((slice, index) => (
          <span key={slice.label}><i className={`chart-key chart-key-${index % 4}`} /> {slice.label} <b className="tnum">{Math.round((slice.value / total) * 100)}%</b></span>
        ))}
      </figcaption>
    </figure>
  );
}

/** A KPI with its change against the previous period of the same length. */
export function StatCard({ label, value, note, change }: { label: string; value: string; note?: string; change?: number | null }) {
  const direction = change === null || change === undefined ? "" : change > 0.5 ? " up" : change < -0.5 ? " down" : " flat";
  return (
    <div className="admin-stat">
      <span>{label}</span>
      <b>{value}</b>
      <small>
        {change !== null && change !== undefined && (
          <em className={`stat-change${direction}`}>{change > 0 ? "↑" : change < 0 ? "↓" : "→"} {Math.abs(change).toFixed(change >= 100 ? 0 : 1)}%</em>
        )}
        {note ? ` ${note}` : ""}
      </small>
    </div>
  );
}
