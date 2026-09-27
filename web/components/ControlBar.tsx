"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import catalog from "@/lib/faults.json";

// The fault menu comes from the same catalog the simulator injects from
// (twin2/catalog.py -> web/lib/faults.json). Engine faults degrade a physical
// health factor; sensor faults corrupt one reading and leave the engine alone.
// The four weak-cylinder faults collapse into one entry plus a cylinder picker.
const WEAK_CYL = "weak_cylinder";
const ENGINE_MENU = [
  ...catalog.engine.filter((f) => f.cylinder === null).map((f) => ({ id: f.id, label: f.label })),
  { id: WEAK_CYL, label: "Weak cylinder" },
];
const SENSOR_MENU = catalog.sensor.map((f) => ({ id: f.id, label: f.label }));
const LABEL: Record<string, string> = Object.fromEntries(
  [...catalog.engine, ...catalog.sensor].map((f) => [f.id, f.label]),
);

const IDLE_TIMEOUT_SECONDS = 120; // 2 minutes

interface Props {
  runId: string | null;
  /** Ground truth from the backend: what is actually active right now. */
  injected: string[];
  onStart: (scenario: string) => void;
  onStop: () => void;
  onInjectFault: (type: string, severity: number, cylinder?: number) => Promise<void> | void;
  onClearFaults: () => Promise<void> | void;
}

export function ControlBar({ runId, injected, onStart, onStop, onInjectFault, onClearFaults }: Props) {
  const [scenario, setScenario] = useState("S1");
  const [faultType, setFaultType] = useState(ENGINE_MENU[0].id);
  const [cylinder, setCylinder] = useState(3);
  const [severity, setSeverity] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-kill on idle settings & timer
  const [idleKillEnabled, setIdleKillEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("twin_autokill_idle");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });
  const [secondsRemaining, setSecondsRemaining] = useState<number>(IDLE_TIMEOUT_SECONDS);
  const [idleNotice, setIdleNotice] = useState<string | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const toggleIdleKill = () => {
    setIdleKillEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("twin_autokill_idle", String(next));
      }
      return next;
    });
  };

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsRemaining(IDLE_TIMEOUT_SECONDS);
  }, []);

  // Global user activity listener to reset the 2-minute idle countdown
  useEffect(() => {
    if (!runId || !idleKillEnabled) return;

    recordActivity();

    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle activity updates to at most once per 500ms
      if (now - lastActivityRef.current > 500) {
        recordActivity();
      }
    };

    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    events.forEach((evt) => window.addEventListener(evt, handleUserActivity, { passive: true }));

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleUserActivity));
    };
  }, [runId, idleKillEnabled, recordActivity]);

  // 1-second countdown ticker when a sortie is live and auto-kill is enabled
  useEffect(() => {
    if (!runId || !idleKillEnabled) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, IDLE_TIMEOUT_SECONDS - elapsed);
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        setIdleNotice("Simulator auto-stopped after 2 min of inactivity to conserve Railway credits.");
        onStopRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId, idleKillEnabled]);

  const perCylinder = faultType === WEAK_CYL;
  const faultId = perCylinder ? `weak_cylinder_cyl${cylinder}` : faultType;
  const alreadyActive = injected.includes(faultId);

  async function run(fn: () => Promise<void> | void) {
    recordActivity();
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

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!runId) {
    return (
      <div className="controls">
        <div className="control-bar">
          <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="S1">Nominal Flight</option>
            <option value="custom">Custom Flight</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={() => {
              setIdleNotice(null);
              run(() => onStart(scenario));
            }}
            disabled={busy}
          >
            Start Flight
          </button>

          <div className="spacer" />

          {/* Idle Auto-Kill Switch Button */}
          <button
            type="button"
            className={`btn btn-toggle-switch ${idleKillEnabled ? "active" : ""}`}
            onClick={toggleIdleKill}
            title={idleKillEnabled ? "Auto-pause after 2m idle" : "Auto-pause off"}
          >
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
            <span className="switch-label">Auto-pause (2m)</span>
          </button>
        </div>

        {idleNotice && (
          <div className="idle-kill-alert">
            <span className="alert-icon">⚡</span>
            <span>{idleNotice}</span>
            <button className="close-btn" onClick={() => setIdleNotice(null)}>×</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="controls">
      <div className="control-bar">
        <select value={faultType} onChange={(e) => setFaultType(e.target.value)}>
          <optgroup label="Engine faults (health factor degrades)">
            {ENGINE_MENU.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
                {injected.includes(f.id) ? " ✓" : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sensor faults (reading lies, engine fine)">
            {SENSOR_MENU.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
                {injected.includes(f.id) ? " ✓" : ""}
              </option>
            ))}
          </optgroup>
        </select>
        {perCylinder && (
          <select value={cylinder} onChange={(e) => setCylinder(Number(e.target.value))} aria-label="Cylinder">
            {[1, 2, 3, 4].map((c) => (
              <option key={c} value={c}>
                cyl {c}
                {injected.includes(`weak_cylinder_cyl${c}`) ? " ✓" : ""}
              </option>
            ))}
          </select>
        )}
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={severity}
          onChange={(e) => {
            recordActivity();
            setSeverity(Number(e.target.value));
          }}
        />
        <span className="mono">{Math.round(severity * 100)}%</span>
        <button className="btn" onClick={() => run(() => onInjectFault(faultId, severity))} disabled={busy}>
          {alreadyActive ? "Update severity" : "Inject fault"}
        </button>
        <button className="btn" onClick={() => run(onClearFaults)} disabled={busy || injected.length === 0}>
          Clear all
        </button>

        <div className="spacer" />

        {/* Idle Auto-Kill Switch & Live Countdown Badge */}
        <div className="idle-control-cluster">
          <button
            type="button"
            className={`btn btn-toggle-switch ${idleKillEnabled ? "active" : ""}`}
            onClick={toggleIdleKill}
            title={idleKillEnabled ? "Auto-kill on 2m idle: ON (Saves Railway credits)" : "Auto-kill on 2m idle: OFF"}
          >
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
            <span className="switch-label">2m Auto-kill</span>
          </button>

          {idleKillEnabled ? (
            <div
              className={`idle-countdown-pill ${secondsRemaining <= 30 ? "warning" : ""}`}
              title="Time until simulator auto-kills due to inactivity (resets on interaction)"
            >
              <span className="pill-dot" />
              <span>Idle: {formatCountdown(secondsRemaining)}</span>
            </div>
          ) : (
            <span className="idle-off-badge">Off</span>
          )}
        </div>

        <button className="btn btn-danger-action" onClick={() => run(onStop)} disabled={busy}>
          End Flight
        </button>
      </div>

      <div className="injected-row">
        <span className="injected-cap">Active faults</span>
        {injected.length === 0 ? (
          <span className="hint">None (nominal)</span>
        ) : (
          injected.map((f) => (
            <span className="injected-chip" key={f}>
              {LABEL[f] ?? f.replace(/_/g, " ")}
            </span>
          ))
        )}
        {injected.length > 1 && <span className="hint">(Compound faults)</span>}
      </div>

      {idleNotice && (
        <div className="idle-kill-alert">
          <span className="alert-icon">⚡</span>
          <span>{idleNotice}</span>
          <button className="close-btn" onClick={() => setIdleNotice(null)}>×</button>
        </div>
      )}

      {error && <div className="control-error">{error}</div>}
    </div>
  );
}
