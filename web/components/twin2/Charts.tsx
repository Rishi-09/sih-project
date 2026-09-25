"use client";

// Minimal SVG charts for the twin2 console: one y-axis, thin 2px lines,
// recessive grid, legend for >= 2 series plus end-of-line labels, crosshair tooltip.
import { useEffect, useRef, useState, ReactNode } from "react";

// Categorical slots (dark steps), validated against --surface #151d22: all checks pass.
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(240, e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(lo: number, hi: number, n = 4) {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) return [lo];
  const span = hi - lo;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Series {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface LineChartProps {
  x: number[];
  series: Series[];
  height?: number;
  xLabel?: string;
  fmt?: (v: number) => string;
  xFmt?: (v: number) => string;
  thresholds?: { y: number; label: string }[];
  markers?: { x: number; label: string }[];
  bands?: { x0: number; x1: number }[];
  yDomain?: [number, number];
  title?: ReactNode;
  endLabels?: boolean;
}

export function LineChart({
  x, series, height = 200, xLabel, fmt = (v) => v.toFixed(2), xFmt = (v) => v.toFixed(0),
  thresholds = [], markers = [], bands = [], yDomain, title, endLabels = false,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const showEnd = endLabels && series.length >= 2 && series.length <= 4;
  const m = { l: 48, r: showEnd ? 74 : 14, t: 10, b: xLabel ? 34 : 22 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && isFinite(v)));
  thresholds.forEach((t) => all.push(t.y));
  let [lo, hi] = yDomain ?? [Math.min(...all), Math.max(...all)];
  if (!yDomain) {
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const sx = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * ih;

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null || !isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.target as SVGRectElement).getBoundingClientRect();
    const xv = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - xv) < Math.abs(x[best] - xv)) best = i;
    setHover(best);
  };

  const yt = niceTicks(lo, hi, 4);
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor(iw / 90)));

  return (
    <div className="t2-chart" ref={ref}>
      {title && <div className="t2-chart-title">{title}</div>}
      {series.length >= 2 && (
        <div className="t2-legend">
          {series.map((s) => (
            <span key={s.id}>
              <i style={{ background: s.dashed ? "transparent" : s.color, borderColor: s.color }}
                 className={s.dashed ? "dashed" : ""} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <svg width={width} height={height} role="img">
          {bands.map((b, i) => (
            <rect key={i} x={sx(b.x0)} y={m.t} width={Math.max(0, sx(b.x1) - sx(b.x0))} height={ih} className="t2-band" />
          ))}
          {yt.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + iw} y1={sy(t)} y2={sy(t)} className="t2-grid" />
              <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className="t2-tick">{fmt(t)}</text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={t} x={sx(t)} y={m.t + ih + 15} textAnchor="middle" className="t2-tick">{xFmt(t)}</text>
          ))}
          {xLabel && <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" className="t2-axis">{xLabel}</text>}
          {thresholds.map((t) => (
            <g key={t.label}>
              <line x1={m.l} x2={m.l + iw} y1={sy(t.y)} y2={sy(t.y)} className="t2-threshold" />
              <text x={m.l + iw - 2} y={sy(t.y) - 4} textAnchor="end" className="t2-threshold-label">{t.label}</text>
            </g>
          ))}
          {markers.map((mk) => (
            <g key={mk.label + mk.x}>
              <line x1={sx(mk.x)} x2={sx(mk.x)} y1={m.t} y2={m.t + ih} className="t2-marker" />
              <text x={sx(mk.x) + 4} y={m.t + 11} className="t2-marker-label">{mk.label}</text>
            </g>
          ))}
          {series.map((s) => (
            <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {showEnd && (() => {
            // end-of-line labels, nudged apart so neighbouring series never overprint
            const labels = series.map((s) => {
              let i = s.values.length - 1;
              while (i >= 0 && s.values[i] == null) i--;
              return i < 0 ? null : { id: s.id, label: s.label, y: sy(s.values[i] as number) + 4 };
            }).filter((l): l is { id: string; label: string; y: number } => l != null).sort((a, b) => a.y - b.y);
            for (let j = 1; j < labels.length; j++) labels[j].y = Math.max(labels[j].y, labels[j - 1].y + 12);
            return labels.map((l) => <text key={l.id} x={m.l + iw + 6} y={l.y} className="t2-endlabel">{l.label}</text>);
          })()}
          {hover != null && (
            <g>
              <line x1={sx(x[hover])} x2={sx(x[hover])} y1={m.t} y2={m.t + ih} className="t2-cross" />
              {series.map((s) => s.values[hover] != null && (
                <circle key={s.id} cx={sx(x[hover])} cy={sy(s.values[hover] as number)} r={4}
                        fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent"
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
        {hover != null && (
          <div className="t2-tooltip" style={{ left: Math.min(sx(x[hover]) + 12, width - 180), top: m.t }}>
            <div className="t2-tooltip-x">{xLabel ?? "x"}: {xFmt(x[hover])}</div>
            {series.map((s) => (
              <div key={s.id}>
                <i style={{ background: s.color }} /> {s.label}: <b>{s.values[hover] == null ? "—" : fmt(s.values[hover] as number)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Reliability diagram: predicted P_complete vs realized completion, dot area ~ sortie count. */
export function ReliabilityPlot({ bins, height = 260 }: {
  bins: { bin: string; n: number; predicted: number; realized: number; failures: number }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 48, r: 14, t: 10, b: 36 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const lo = Math.max(0, Math.min(0.6, ...bins.map((b) => Math.min(b.predicted, b.realized)) ) - 0.05);
  const sx = (v: number) => m.l + ((v - lo) / (1 - lo)) * iw;
  const sy = (v: number) => m.t + (1 - (v - lo) / (1 - lo)) * ih;
  const ticks = niceTicks(lo, 1, 4);
  const maxN = Math.max(...bins.map((b) => b.n));
  return (
    <div className="t2-chart" ref={ref}>
      <div style={{ position: "relative" }}>
        <svg width={width} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + iw} y1={sy(t)} y2={sy(t)} className="t2-grid" />
              <text x={m.l - 6} y={sy(t) + 4} textAnchor="end" className="t2-tick">{t.toFixed(2)}</text>
              <text x={sx(t)} y={m.t + ih + 15} textAnchor="middle" className="t2-tick">{t.toFixed(2)}</text>
            </g>
          ))}
          <line x1={sx(lo)} y1={sy(lo)} x2={sx(1)} y2={sy(1)} className="t2-threshold" />
          <text x={sx(lo + (1 - lo) * 0.18)} y={sy(lo + (1 - lo) * 0.18) - 8} className="t2-threshold-label"
                transform={`rotate(${(-Math.atan2(ih, iw) * 180) / Math.PI} ${sx(lo + (1 - lo) * 0.18)} ${sy(lo + (1 - lo) * 0.18) - 8})`}>perfect calibration</text>
          <text x={m.l + iw / 2} y={height - 4} textAnchor="middle" className="t2-axis">predicted P_complete (pre-flight, out-of-fold)</text>
          {bins.map((b, i) => (
            <circle key={b.bin} cx={sx(b.predicted)} cy={sy(b.realized)} r={5 + 9 * Math.sqrt(b.n / maxN)}
                    fill={SERIES[0]} fillOpacity={0.85} stroke="var(--surface)" strokeWidth={2}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {hover != null && (
          <div className="t2-tooltip" style={{ left: Math.min(sx(bins[hover].predicted) + 14, width - 200), top: 10 }}>
            <div className="t2-tooltip-x">bin {bins[hover].bin}</div>
            <div>{bins[hover].n} sorties · {bins[hover].failures} failures</div>
            <div>predicted <b>{bins[hover].predicted.toFixed(3)}</b></div>
            <div>realized <b>{bins[hover].realized.toFixed(3)}</b></div>
          </div>
        )}
      </div>
      <div className="t2-note">y: realized completion rate. Dot area is proportional to the number of sorties in the bin.</div>
    </div>
  );
}

/** Horizontal meter for "fraction of the way to failure". */
export function DeficitBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const cls = v >= 0.75 ? "critical" : v >= 0.4 ? "caution" : "ok";
  return (
    <span className="t2-meter" title={`${(100 * value).toFixed(0)}% of the way to the failure threshold`}>
      <span className={`t2-meter-fill ${cls}`} style={{ width: `${Math.max(2, v * 100)}%` }} />
    </span>
  );
}
