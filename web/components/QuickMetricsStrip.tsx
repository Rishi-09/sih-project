"use client";

import { useEffect, useState } from "react";
import { TickFrame } from "@/lib/types";

interface Props {
  frame?: TickFrame | null;
  tail?: string;
  totalAirframes?: number;
  activeSorties?: number;
}

export function QuickMetricsStrip({ frame, tail, totalAirframes, activeSorties }: Props) {
  const [timeStr, setTimeStr] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const ist = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });
      const utc = now.toISOString().slice(11, 19);
      setTimeStr(`UTC ${utc}Z | IST ${ist}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isLive = Boolean(frame);

  // Correct Rotax 915 iS sensor keys from telemetry contract
  const rawRpm = frame?.sensors?.rpm ?? frame?.sensors?.engine_rpm;
  const rawMapKpa = frame?.sensors?.map_kpa ?? (frame?.sensors?.map_bar !== undefined ? frame.sensors.map_bar * 100 : undefined);
  const rawCoolant = frame?.sensors?.coolant_temp_c;
  const rawOilPress = frame?.sensors?.oil_press_bar ?? frame?.sensors?.oil_pressure_bar;
  const rawOilTemp = frame?.sensors?.oil_temp_c;
  const rawFuelFlow = frame?.sensors?.fuel_flow_lph;

  // Values with pre-flight standby defaults when aircraft is powered on ground
  const rpm = rawRpm !== undefined ? Math.round(rawRpm) : (tail ? 0 : null);
  const mapBar = rawMapKpa !== undefined
    ? (rawMapKpa > 15 ? rawMapKpa / 100 : rawMapKpa)
    : (tail ? 1.01 : null);
  const coolant = rawCoolant !== undefined ? rawCoolant : (tail ? 25.0 : null);
  const oilPress = rawOilPress !== undefined ? rawOilPress : (tail ? 0.0 : null);
  const oilTemp = rawOilTemp !== undefined ? rawOilTemp : (tail ? 24.5 : null);
  const fuelFlow = rawFuelFlow !== undefined ? rawFuelFlow : (tail ? 0.0 : null);

  const showEngineMetrics = rpm !== null;

  return (
    <div className="telemetry-metrics-strip">
      <div className="metrics-strip-header">
        <div className="strip-title-section">
          <span className="strip-id">{tail ? tail : "Fleet Telemetry"}</span>
          <span className="strip-divider">•</span>
          <span className="strip-clock">{timeStr}</span>
        </div>
        <div className="strip-health-status">
          <span
            className="status-indicator-dot"
            style={{ background: isLive ? "#22c55e" : "#38bdf8" }}
          />
          <span className="status-indicator-text">
            {isLive ? "20 Hz Live" : (tail ? "Standby Baseline" : "Fleet Overview")}
          </span>
        </div>
      </div>

      <div className="metrics-strip-grid">
        {totalAirframes !== undefined && (
          <div className="metric-chip">
            <span className="metric-key">Aircraft</span>
            <span className="metric-val">{totalAirframes}</span>
          </div>
        )}

        {activeSorties !== undefined && (
          <div className="metric-chip">
            <span className="metric-key">Active Sorties</span>
            <span className="metric-val" style={{ color: activeSorties > 0 ? "var(--ok)" : "inherit" }}>
              {activeSorties}
            </span>
          </div>
        )}

        {showEngineMetrics && (
          <>
            <div className="metric-chip">
              <span className="metric-key">Engine RPM</span>
              <span className="metric-val">{rpm}</span>
              <span className="metric-unit">rpm</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">MAP</span>
              <span className="metric-val">{mapBar !== null ? mapBar.toFixed(2) : "1.01"}</span>
              <span className="metric-unit">bar</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Coolant</span>
              <span className="metric-val">{coolant !== null ? coolant.toFixed(1) : "25.0"}</span>
              <span className="metric-unit">°C</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Oil Pressure</span>
              <span className="metric-val">{oilPress !== null ? oilPress.toFixed(2) : "0.00"}</span>
              <span className="metric-unit">bar</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Oil Temp</span>
              <span className="metric-val">{oilTemp !== null ? oilTemp.toFixed(1) : "24.5"}</span>
              <span className="metric-unit">°C</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Fuel Flow</span>
              <span className="metric-val">{fuelFlow !== null ? fuelFlow.toFixed(1) : "0.0"}</span>
              <span className="metric-unit">L/h</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
