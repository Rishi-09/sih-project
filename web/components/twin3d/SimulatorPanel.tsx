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

// Ground standby baseline for Rotax 915 iS engine prior to ignition
const STANDBY_SENSORS: Record<string, number> = {
  rpm: 0,
  map_kpa: 101.3,
  egt_1: 25.0,
  egt_2: 25.0,
  egt_3: 25.0,
  egt_4: 25.0,
  cht_1: 25.0,
  cht_2: 25.0,
  cht_3: 25.0,
  cht_4: 25.0,
  oil_press_bar: 0.0,
  oil_temp_c: 24.5,
  coolant_temp_c: 25.0,
  fuel_flow_lph: 0.0,
  fuel_press_bar: 0.0,
  inj_timing_deg: 0.0,
  vib_rms_g: 0.01,
  bus_voltage_v: 28.2,
  alt_current_a: 0.0,
};

export function SimulatorPanel({ frame }: Props) {
  const isLive = Boolean(frame);

  return (
    <div className="panel-inner sim-panel-scroll">
      <div className="panel-header-badge">
        <span className="badge-title">Telemetry Bus</span>
        <span
          className="badge-freq"
          style={{
            background: isLive ? "rgba(34, 197, 94, 0.15)" : "rgba(56, 189, 248, 0.15)",
            color: isLive ? "#4ade80" : "#38bdf8",
            border: `1px solid ${isLive ? "rgba(34, 197, 94, 0.4)" : "rgba(56, 189, 248, 0.35)"}`,
          }}
        >
          {isLive ? "20 Hz Live" : "Standby Baseline"}
        </span>
      </div>

      {/* Flight Context */}
      <div className="section-block">
        <div className="section-title">
          Flight State {!isLive && <span style={{ opacity: 0.6, fontSize: "10px" }}>(Ground Repos)</span>}
        </div>
        <div className="context-mini-grid">
          <div className="context-item">
            <span className="ctx-k">Throttle</span>
            <span className="ctx-v">{frame ? `${frame.context.throttle_pct.toFixed(0)}%` : "0%"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">Altitude</span>
            <span className="ctx-v">{frame ? `${frame.context.alt_m.toFixed(0)} m` : "0 m (GND)"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">Airspeed</span>
            <span className="ctx-v">{frame ? `${frame.context.ias_kt.toFixed(0)} kt` : "0 kt"}</span>
          </div>
          <div className="context-item">
            <span className="ctx-k">OAT</span>
            <span className="ctx-v">{frame ? `${frame.context.oat_c.toFixed(1)} °C` : "25.0 °C"}</span>
          </div>
        </div>
      </div>

      {/* 19 Engine Sensors */}
      <div className="section-block">
        <div className="section-title">
          Engine Sensors (19) {!isLive && <span style={{ opacity: 0.6, fontSize: "10px" }}>(Nominal Standby)</span>}
        </div>
        <div className="sensor-list-table">
          <div className="sensor-list-header">
            <span>Sensor</span>
            <span>Value</span>
            <span>Residual</span>
          </div>
          {ENGINE_CHANNELS.map((ch) => {
            const val = frame?.sensors?.[ch] ?? STANDBY_SENSORS[ch] ?? 0;
            const z = frame?.residualZ?.[ch] ?? 0;
            const unit = CHANNEL_UNITS[ch] ?? "";

            return (
              <div key={ch} className={`sensor-list-row ${isLive ? zClass(z) : ""}`}>
                <span className="sensor-ch-name">{ch}</span>
                <span className="sensor-ch-val">
                  {ch === "rpm" ? Math.round(val) : val.toFixed(2)}
                  <span className="unit-label">{unit}</span>
                </span>
                <span className="sensor-ch-z">
                  {isLive ? `${z >= 0 ? "+" : ""}${z.toFixed(1)}σ` : "0.0σ"}
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
