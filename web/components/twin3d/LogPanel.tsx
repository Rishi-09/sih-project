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

export function LogPanel({ frame }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastProcessedTRef = useRef<number | null>(null);

  useEffect(() => {
    if (!frame) return;

    if (lastProcessedTRef.current === frame.t) return;
    lastProcessedTRef.current = frame.t;

    // A row counts as a fault row if EITHER the model says so or a fault is
    // actually injected — a log that prints "healthy" while faults are running
    // is worse than no log, and it was what made the classifier's lag look like
    // a dead pipeline.
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
      if (next.length > 250) next.shift(); // Keep last 250 entries
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
          <div className="log-empty">System initialized. Awaiting live flight telemetry ticks...</div>
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
              {/* Ground truth beside the prediction. The classifier needs a
                  60-second feature window, so it legitimately lags an injection
                  by a few evaluations; printing only its verdict made that lag
                  read as "the faults are being ignored". */}
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
