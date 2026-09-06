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
  /** Ground truth from the backend: what is actually active right now. */
  injected: string[];
  onStart: (scenario: string) => void;
  onStop: () => void;
  onInjectFault: (type: string, severity: number, cylinder?: number) => Promise<void> | void;
  onClearFaults: () => Promise<void> | void;
}

/**
 * Scenario controls.
 *
 * The active-fault chips are the important addition. Faults accumulate — this
 * is how a compound failure is built up — but with nothing on screen confirming
 * that a second injection had been accepted, and a diagnosis label that only
 * ever named one fault, injecting a second one looked exactly like being
 * ignored. The chips are echoed back from the telemetry frame, so they are
 * proof the backend took the command, not local optimism.
 */
export function ControlBar({ runId, injected, onStart, onStop, onInjectFault, onClearFaults }: Props) {
  const [scenario, setScenario] = useState("S1");
  const [faultType, setFaultType] = useState(FAULT_TYPES[0]);
  const [severity, setSeverity] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locked to cylinder 3 — Retribution's simulator hardcodes both per-cylinder
  // faults there today (SIMULATOR_CONTEXT.md §14); a picker would offer a
  // choice the backend can't actually honor.
  const perCylinder = faultType === "ignition_fault_cyl3" || faultType === "injector_fault_cyl3";
  const alreadyActive = injected.includes(faultType);

  async function run(fn: () => Promise<void> | void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!runId) {
    return (
      <div className="control-bar">
        <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
          <option value="S1">S1 — Nominal sortie</option>
          <option value="custom">Custom mission</option>
        </select>
        <button className="btn btn-primary" onClick={() => run(() => onStart(scenario))} disabled={busy}>
          Start sortie
        </button>
      </div>
    );
  }

  return (
    <div className="controls">
      <div className="control-bar">
        <select value={faultType} onChange={(e) => setFaultType(e.target.value)}>
          {FAULT_TYPES.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, " ")}
              {injected.includes(f) ? " ✓" : ""}
            </option>
          ))}
        </select>
        {perCylinder && (
          <span className="mono hint">cyl 3 (fixed)</span>
        )}
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
        />
        <span className="mono">{Math.round(severity * 100)}%</span>
        <button className="btn" onClick={() => run(() => onInjectFault(faultType, severity))} disabled={busy}>
          {alreadyActive ? "Update severity" : "Inject fault"}
        </button>
        <button className="btn" onClick={() => run(onClearFaults)} disabled={busy || injected.length === 0}>
          Clear all
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => run(onStop)} disabled={busy}>
          Stop sortie
        </button>
      </div>

      <div className="injected-row">
        <span className="injected-cap">Active faults</span>
        {injected.length === 0 ? (
          <span className="hint">none — engine is healthy</span>
        ) : (
          injected.map((f) => (
            <span className="injected-chip" key={f}>
              {f.replace(/_/g, " ")}
            </span>
          ))
        )}
        {injected.length > 1 && <span className="hint">compound — faults stack, they do not replace</span>}
      </div>

      {error && <div className="control-error">{error}</div>}
    </div>
  );
}

