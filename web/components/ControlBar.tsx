"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";

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
  const [faultType, setFaultType] = useState(FAULT_TYPES[0]);
  const [severity, setSeverity] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Point 8: Instantaneous launch feedback state
  const [launchStage, setLaunchStage] = useState<"idle" | "launching" | "spooling">("idle");

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
      if (now - lastActivityRef.current > 500) {
        recordActivity();
      }
    };

    // Only intentional user inputs (click, touch, keydown) reset the idle activity timer.
    // Passive mouse hovering (pointermove) or scrolling no longer resets it.
    const events = ["pointerdown", "keydown", "touchstart"];
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
        setIdleNotice("Simulator auto-stopped after 2 min of inactivity to conserve compute resources.");
        onStopRef.current();
        api.stopRun(runId).catch(() => {});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [runId, idleKillEnabled]);

  const perCylinder = faultType === "ignition_fault_cyl3" || faultType === "injector_fault_cyl3";
  const alreadyActive = injected.includes(faultType);

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
      setLaunchStage("idle");
    }
  }

  const handleStartSortie = () => {
    setIdleNotice(null);
    // Point 8: Instantaneous state change within 0ms
    setLaunchStage("launching");
    setTimeout(() => {
      setLaunchStage("spooling");
    }, 700);

    run(() => onStart(scenario));
  };

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!runId) {
    return (
      <div className="controls">
        <div className="control-bar">
          <select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={busy}>
            <option value="S1">S1 — Nominal sortie</option>
            <option value="custom">Custom mission</option>
          </select>

          {/* Point 8: Instantaneous visual feedback button */}
          <button
            className="btn btn-primary"
            onClick={handleStartSortie}
            disabled={busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: "150px",
              justifyContent: "center",
            }}
          >
            {launchStage === "launching" ? (
              <>
                <span className="spinner-icon-anim">⚡</span>
                <span>Connecting FADEC...</span>
              </>
            ) : launchStage === "spooling" ? (
              <>
                <span className="spinner-icon-anim">⚙️</span>
                <span>Spooling Engine...</span>
              </>
            ) : (
              <span>Start sortie</span>
            )}
          </button>

          <div className="spacer" />

          {/* Idle Auto-Kill Switch Button */}
          <button
            type="button"
            className={`btn btn-toggle-switch ${idleKillEnabled ? "active" : ""}`}
            onClick={toggleIdleKill}
            title={idleKillEnabled ? "Auto-kill on 2m idle: ON (Saves Railway credits)" : "Auto-kill on 2m idle: OFF"}
          >
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
            <span className="switch-label">Auto-kill on 2m idle</span>
          </button>
        </div>

        {/* Point 8: Live launch step progress indicator during the 2-sec startup */}
        {launchStage !== "idle" && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 14px",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(52, 211, 153, 0.3)",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: "12px",
              color: "#34d399",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>✓</span>
              <span>1. FADEC Handshake</span>
            </div>
            <span>→</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
              <span className="spinner-icon-anim">✦</span>
              <span>2. Initializing Rotax 915 Physics Simulator</span>
            </div>
            <span>→</span>
            <div style={{ color: "#64748b" }}>
              <span>3. 1 Hz Stream</span>
            </div>
          </div>
        )}

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

  return (
    <div className="controls">
      <div className="control-bar">
        <div className="control-group-fault">
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
          <div className="control-slider-box">
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
          </div>
          <div className="fault-btn-group">
            <button className="btn" onClick={() => run(() => onInjectFault(faultType, severity))} disabled={busy}>
              {alreadyActive ? "Update severity" : "Inject fault"}
            </button>
            <button className="btn" onClick={() => run(onClearFaults)} disabled={busy || injected.length === 0}>
              Clear all
            </button>
          </div>
        </div>

        <div className="spacer" />

        {/* Action Controls & Stop Sortie */}
        <div className="control-group-actions">
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
            Stop sortie
          </button>
        </div>
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
