"use client";

import { ENGINE_CHANNELS, CHANNEL_UNITS, TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
}

function zClass(z: number | undefined): string {
  if (z === undefined) return "";
  const abs = Math.abs(z);
  if (abs >= 3) return "z-crit";
  if (abs >= 2) return "z-warn";
  return "z-norm";
}

export function SimulatorPanel({ frame }: Props) {
  return (
    <div className="panel-inner sim-panel-scroll">
      <div className="panel-header-badge">
        <span className="badge-title">SIMULATOR TELEMETRY</span>
        <span className="badge-freq">1 HZ STREAM</span>
      </div>

      {/* Flight Context */}
      <div className="section-block">
        <div className="section-title">FLIGHT CONTEXT</div>
        <div className="context-mini-grid">
          <div className="context-item">
            <span className="ctx-k">THROTTLE</span>
            <span className="ctx-v">{frame ? `${frame.context.throttle_pct.toFixed(0)}%` : "—"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">ALTITUDE</span>
            <span className="ctx-v">{frame ? `${frame.context.alt_m.toFixed(0)} m` : "—"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">AIRSPEED</span>
            <span className="ctx-v">{frame ? `${frame.context.ias_kt.toFixed(0)} kt` : "—"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">OAT</span>
            <span className="ctx-v">{frame ? `${frame.context.oat_c.toFixed(1)} °C` : "—"}</span>
          </div>
        </div>
      </div>

      {/* 19 Engine Sensors */}
      <div className="section-block">
        <div className="section-title">19 ENGINE SENSORS</div>
        <div className="sensor-list-table">
          <div className="sensor-list-header">
            <span>CHANNEL</span>
            <span>VALUE</span>
            <span>RESIDUAL</span>
          </div>
          {ENGINE_CHANNELS.map((ch) => {
            const val = frame?.sensors?.[ch];
            const z = frame?.residualZ?.[ch];
            const unit = CHANNEL_UNITS[ch] ?? "";

            return (
              <div key={ch} className={`sensor-list-row ${zClass(z)}`}>
                <span className="sensor-ch-name">{ch}</span>
                <span className="sensor-ch-val">
                  {val !== undefined ? (ch === "rpm" ? val.toFixed(0) : val.toFixed(2)) : "—"}
                  <span className="unit-label">{unit}</span>
                </span>
                <span className="sensor-ch-z">
                  {z !== undefined ? `${z >= 0 ? "+" : ""}${z.toFixed(1)}σ` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Alerts */}
      {frame?.alerts && frame.alerts.length > 0 && (
        <div className="section-block">
          <div className="section-title critical-text">ACTIVE ALERTS ({frame.alerts.length})</div>
          <div className="alerts-compact-list">
            {frame.alerts.map((a, i) => (
              <div key={i} className={`alert-badge-item alert-${a.severity}`}>
                <span className="alert-code">{a.code}</span>
                <span className="alert-msg">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
