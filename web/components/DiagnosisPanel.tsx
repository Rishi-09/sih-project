"use client";

import { TickFrame } from "@/lib/types";

export function DiagnosisPanel({ frame }: { frame: TickFrame | null }) {
  if (!frame) return <p style={{ color: "var(--ink-3)" }}>No telemetry yet.</p>;
  const { diagnosis, health } = frame;
  const sortedProbs = Object.entries(diagnosis.probs).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="diag-label">
        {diagnosis.label.replace(/_/g, " ")}
        {diagnosis.cylinder ? ` — cyl ${diagnosis.cylinder}` : ""}
      </div>
      <div className="diag-conf">
        confidence {Math.round(diagnosis.confidence * 100)}% · anomaly score {diagnosis.anomalyScore.toFixed(2)}
      </div>

      {sortedProbs.map(([label, p]) => (
        <div className="prob-bar-row" key={label}>
          <div className="name">{label.replace(/_/g, " ")}</div>
          <div className="prob-bar-track">
            <div className="prob-bar-fill" style={{ width: `${Math.min(100, p * 100)}%` }} />
          </div>
          <div className="prob-bar-pct">{Math.round(p * 100)}%</div>
        </div>
      ))}

      {diagnosis.sensorFault.channel && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--caution)" }}>
          ⚠ {diagnosis.sensorFault.channel} looks {diagnosis.sensorFault.mode} — likely a sensor fault, not an engine fault.
        </div>
      )}

      <h2 style={{ marginTop: 18 }}>Subsystem health</h2>
      {Object.entries(health.subsystems).map(([name, score]) => (
        <div className="kv-row" key={name}>
          <span className="k">{name}</span>
          <span className="v">{score.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
