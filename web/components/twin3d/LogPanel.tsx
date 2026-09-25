"use client";

import { useEffect, useRef, useState } from "react";
import { TickFrame } from "@/lib/types";

interface LogEntry {
  id: string;
  t: number;
  timeStr: string;
  phase: string;
  ehi: number | null;
  label: string;
  /** Ground truth: what is actually injected, independent of the model. */
  injected: string[];
  isFault: boolean;
  alertMsg?: string;
}

interface Props {
  frame: TickFrame | null;
}

const INITIAL_BOOT_LOGS: LogEntry[] = [
  {
    id: "init_0",
    t: 0,
    timeStr: "00:00:01",
    phase: "STANDBY",
    ehi: 100,
    label: "Dual FADEC ECU online — MIL-STD-1553B bus connected",
    injected: [],
    isFault: false,
  },
  {
    id: "init_1",
    t: 0,
    timeStr: "00:00:02",
    phase: "STANDBY",
    ehi: 100,
    label: "Built-In-Test (BIT) passed — 19 telemetry channels calibrated",
    injected: [],
    isFault: false,
  },
  {
    id: "init_2",
    t: 0,
    timeStr: "00:00:03",
    phase: "STANDBY",
    ehi: 100,
    label: "Rotax 915 iS propulsion twin initialized in nominal state",
    injected: [],
    isFault: false,
  },
];

export function LogPanel({ frame }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_BOOT_LOGS);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastProcessedTRef = useRef<number | null>(null);

  useEffect(() => {
    if (!frame) return;

    if (lastProcessedTRef.current === frame.t) return;
    lastProcessedTRef.current = frame.t;

    const isFault = frame.diagnosis.label !== "healthy" || frame.injectedFaults.length > 0;
    const alertMsg = frame.alerts.length > 0 ? frame.alerts[0].message : undefined;

    const entry: LogEntry = {
      id: `${frame.runId}_${frame.t}_${Date.now()}`,
      t: frame.t,
      timeStr: new Date().toLocaleTimeString(),
      phase: frame.phase,
      ehi: frame.health.ehi === null ? null : Math.round(frame.health.ehi),
      label: frame.diagnosis.label,
      injected: frame.injectedFaults,
      isFault,
      alertMsg,
    };

    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > 250) next.shift();
      return next;
    });
  }, [frame]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div className="log-panel-container">
      <div className="log-toolbar">
        <div className="log-title">
          <span className="log-icon">⬢</span>
          <span>SYSTEM LOG & TELEMETRY STREAM</span>
          <span className="log-count">({logs.length} events)</span>
        </div>
        <div className="log-actions">
          <label className="autoscroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
          <button className="clear-btn" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>
      </div>

      <div ref={logContainerRef} className="log-stream-body">
        {logs.length === 0 ? (
          <div className="log-empty">Log stream cleared. Standby for incoming telemetry frames...</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`log-row ${log.isFault ? "log-fault-row" : ""} ${log.alertMsg ? "log-alert-row" : ""}`}
            >
              <span className="log-ts">[{log.timeStr}]</span>
              <span className="log-t-sec">T+{log.t}s</span>
              <span className="log-phase">[{log.phase}]</span>
              <span className="log-ehi">EHI:{log.ehi === null ? "—" : log.ehi}</span>
              <span className={`log-diag ${log.isFault ? "text-crit" : "text-ok"}`}>
                DIAG: {log.label}
              </span>
              {log.injected.length > 0 && (
                <span className="log-injected">INJ: {log.injected.join(" + ")}</span>
              )}
              {log.alertMsg && <span className="log-alert-text">⚠ {log.alertMsg}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
