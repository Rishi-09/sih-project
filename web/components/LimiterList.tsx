"use client";

import { ReliabilityLimiter } from "@/lib/types";

/**
 * The evidence behind the headline: which channels are actually consuming the
 * mission's margin, most urgent first.
 *
 * This replaces reading 19 equally-weighted sensor tiles and inferring the
 * answer. Every row here is a channel that is either moving toward a limit or
 * has already given up most of its headroom — a channel with full margin and no
 * trend is not shown, because "nothing to report" is best communicated by an
 * empty list rather than by twenty green numbers.
 */

const CHANNEL_NAMES: Record<string, string> = {
  rpm: "RPM",
  map_kpa: "Manifold pressure",
  oil_press_bar: "Oil pressure",
  oil_temp_c: "Oil temperature",
  coolant_temp_c: "Coolant temperature",
  fuel_flow_lph: "Fuel flow",
  fuel_press_bar: "Fuel pressure",
  inj_timing_deg: "Injection timing",
  vib_rms_g: "Vibration",
  bus_voltage_v: "Bus voltage",
  alt_current_a: "Alternator current",
};

export function channelName(id: string): string {
  if (CHANNEL_NAMES[id]) return CHANNEL_NAMES[id];
  const cyl = /^(egt|cht)_(\d)$/.exec(id);
  if (cyl) return `${cyl[1].toUpperCase()} cyl ${cyl[2]}`;
  return id.replace(/_/g, " ");
}

function fmtDur(sec: number): string {
  if (sec <= 0) return "now";
  if (sec < 90) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Margin bars run full-to-empty, so a shrinking bar always means worse. */
function marginTone(l: ReliabilityLimiter): string {
  if (l.secondsToLimit !== null && l.secondsToLimit <= 0) return "critical";
  if (l.beyondCaution) return "critical";
  if (l.headroomPct < 35 || (l.secondsToLimit !== null && l.secondsToLimit < 600)) return "caution";
  return "ok";
}

export function LimiterList({ limiters }: { limiters: ReliabilityLimiter[] }) {
  // Only channels that are actually constraining the mission. The engine sorts
  // them; this decides which are worth an operator's attention at all.
  const shown = limiters.filter((l) => l.secondsToLimit !== null || l.beyondCaution || l.headroomPct < 60);

  if (shown.length === 0) {
    return <p className="limiter-empty">Every channel is well inside its limits with no trend toward one.</p>;
  }

  return (
    <div className="limiter-list">
      {shown.map((l) => {
        const tone = marginTone(l);
        return (
          <div className={`limiter tone-${tone}`} key={l.channel}>
            <div className="limiter-head">
              <span className="limiter-name">{channelName(l.channel)}</span>
              <span className="limiter-now">
                {l.value}
                {l.unit}
                <span className="limiter-limit">
                  {" "}
                  / {l.limitKind === "high" ? "max" : "min"} {l.limit}
                  {l.unit}
                </span>
              </span>
            </div>
            <div className="margin-bar">
              <div className="margin-fill" style={{ width: `${l.headroomPct}%` }} />
            </div>
            <div className="limiter-foot">
              <span>{Math.round(l.headroomPct)}% margin left</span>
              {l.secondsToLimit !== null ? (
                <span className="limiter-eta">
                  {l.secondsToLimit <= 0 ? "at its limit now" : `reaches limit in ${fmtDur(l.secondsToLimit)}`}
                </span>
              ) : l.beyondCaution ? (
                <span className="limiter-eta">holding past caution</span>
              ) : (
                <span className="limiter-eta steady">steady</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
