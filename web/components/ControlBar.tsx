"use client";

import { useState } from "react";

// Matches contract/faults.json exactly (transcribed from Retribution's
// faults.py — the source of truth). ignition_fault_cyl3 / injector_fault_cyl3
// are hardcoded to cylinder 3 in the real simulator today, and the two sensor
// faults each target one fixed channel — no cylinder or channel picker for
// any of these, since a different choice wouldn't be honored.
const FAULT_TYPES = [
  "lubrication_degradation",
  "cooling_failure",
  "ignition_fault_cyl3",
  "induction_loss",
  "fuel_system_degradation",
  "bearing_wear",
  "injector_fault_cyl3",
  "electrical_degradation",
  "sensor_freeze_coolant",
  "sensor_drift_oilpress",
];

interface Props {
  runId: string | null;
  onStart: (scenario: string) => void;
  onStop: () => void;
  onInjectFault: (type: string, severity: number, cylinder?: number) => void;
}

export function ControlBar({ runId, onStart, onStop, onInjectFault }: Props) {
  const [scenario, setScenario] = useState("S1");
  const [faultType, setFaultType] = useState(FAULT_TYPES[0]);
  const [severity, setSeverity] = useState(0.6);
  // Locked to cylinder 3 — Retribution's simulator hardcodes both per-cylinder
  // faults there today (SIMULATOR_CONTEXT.md §14); a picker would offer a
  // choice the backend can't actually honor.
  const perCylinder = faultType === "ignition_fault_cyl3" || faultType === "injector_fault_cyl3";

  return (
    <div className="control-bar">
      {!runId ? (
        <>
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="S1">S1 — Nominal sortie</option>
            <option value="custom">Custom mission</option>
          </select>
          <button className="btn btn-primary" onClick={() => onStart(scenario)}>
            Start sortie
          </button>
        </>
      ) : (
        <>
          <select value={faultType} onChange={(e) => setFaultType(e.target.value)}>
            {FAULT_TYPES.map((f) => (
              <option key={f} value={f}>
                {f.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {perCylinder && (
            <span className="mono" style={{ fontSize: 12, opacity: 0.7 }}>
              cyl 3 (fixed)
            </span>
          )}
          <input type="range" min={0.1} max={1} step={0.1} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} />
          <span className="mono" style={{ fontSize: 12 }}>
            {Math.round(severity * 100)}%
          </span>
          <button className="btn" onClick={() => onInjectFault(faultType, severity)}>
            Inject fault
          </button>
          <button className="btn" onClick={onStop}>
            Stop sortie
          </button>
        </>
      )}
    </div>
  );
}
