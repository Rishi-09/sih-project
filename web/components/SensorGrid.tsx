"use client";

import { CHANNEL_UNITS, ENGINE_CHANNELS, TickFrame } from "@/lib/types";

function zClass(z: number | undefined): string {
  if (z === undefined) return "";
  const abs = Math.abs(z);
  if (abs >= 3) return "z-crit";
  if (abs >= 2) return "z-warn";
  return "";
}

export function SensorGrid({ frame }: { frame: TickFrame | null }) {
  return (
    <div className="sensor-grid">
      {ENGINE_CHANNELS.map((ch) => {
        const value = frame?.sensors[ch];
        const z = frame?.residualZ[ch];
        return (
          <div key={ch} className={`sensor-cell ${zClass(z)}`}>
            <div className="label">{ch.replace(/_/g, " ")}</div>
            <div className="value">
              {value !== undefined ? value.toFixed(ch === "rpm" ? 0 : 2) : "—"}
              <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: 4 }}>{CHANNEL_UNITS[ch]}</span>
            </div>
            <div className="z">{z !== undefined ? `${z >= 0 ? "+" : ""}${z.toFixed(1)}σ` : "no data"}</div>
          </div>
        );
      })}
    </div>
  );
}
