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

  const rpm = frame?.sensors?.engine_rpm ?? 0;
  const map = frame?.sensors?.map_bar ?? 0;
  const coolant = frame?.sensors?.coolant_temp_c ?? 0;
  const oilPress = frame?.sensors?.oil_pressure_bar ?? 0;
  const oilTemp = frame?.sensors?.oil_temp_c ?? 0;
  const fuelFlow = frame?.sensors?.fuel_flow_lph ?? 0;

  return (
    <div className="telemetry-metrics-strip">
      <div className="metrics-strip-header">
        <div className="strip-title-section">
          <span className="strip-id">{tail ? tail : "Fleet Telemetry"}</span>
          <span className="strip-divider">•</span>
          <span className="strip-clock">{timeStr}</span>
        </div>
        <div className="strip-health-status">
          <span className="status-indicator-dot" />
          <span className="status-indicator-text">20 Hz Live</span>
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

        {frame && (
          <>
            <div className="metric-chip">
              <span className="metric-key">Engine RPM</span>
              <span className="metric-val">{rpm > 0 ? Math.round(rpm) : "—"}</span>
              <span className="metric-unit">rpm</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">MAP</span>
              <span className="metric-val">{map > 0 ? map.toFixed(2) : "—"}</span>
              <span className="metric-unit">bar</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Coolant</span>
              <span className="metric-val">{coolant > 0 ? coolant.toFixed(1) : "—"}</span>
              <span className="metric-unit">°C</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Oil Pressure</span>
              <span className="metric-val">{oilPress > 0 ? oilPress.toFixed(2) : "—"}</span>
              <span className="metric-unit">bar</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Oil Temp</span>
              <span className="metric-val">{oilTemp > 0 ? oilTemp.toFixed(1) : "—"}</span>
              <span className="metric-unit">°C</span>
            </div>

            <div className="metric-chip">
              <span className="metric-key">Fuel Flow</span>
              <span className="metric-val">{fuelFlow > 0 ? fuelFlow.toFixed(1) : "—"}</span>
              <span className="metric-unit">L/h</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
