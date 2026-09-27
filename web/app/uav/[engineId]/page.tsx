"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { useTwinSocket } from "@/lib/socket";
import { MissionStatus } from "@/components/MissionStatus";
import { LimiterList } from "@/components/LimiterList";
import { WhatIfPlanner } from "@/components/WhatIfPlanner";
import { DetailTabs } from "@/components/DetailTabs";
import { ControlBar } from "@/components/ControlBar";
import { MiniTwinPreview } from "@/components/MiniTwinPreview";

export default function ConsolePage() {
  const params = useParams<{ engineId: string }>();
  const engineId = params.engineId;

  const [engine, setEngine] = useState<EngineSummary | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .engines()
      .then((engines) => {
        if (cancelled) return;
        const e = engines.find((x) => x.id === engineId) ?? null;
        setEngine(e);
        if (e?.latestRunStatus === "live" || e?.latestRunStatus === "degraded") setRunId(e.latestRunId);
      })
      .finally(() => !cancelled && setLoadingEngine(false));
    return () => {
      cancelled = true;
    };
  }, [engineId]);

  const twin = useTwinSocket(runId);

  const [runDead, setRunDead] = useState(false);
  const noFrameYet = Boolean(runId) && !twin.latest;
  useEffect(() => {
    if (!runId || !noFrameYet) {
      setRunDead(false);
      return;
    }
    let cancelled = false;
    const check = () =>
      api
        .runStatus(runId)
        .then((s) => !cancelled && setRunDead(!s.active))
        .catch(() => !cancelled && setRunDead(true));
    const timer = setTimeout(check, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, noFrameYet]);

  async function handleStart(scenario: string) {
    const { runId: newRunId } = await api.startRun(engineId, scenario);
    setRunId(newRunId);
  }

  async function handleStop() {
    if (!runId) return;
    try {
      await api.stopRun(runId);
    } catch {
      /* already gone server-side */
    }
    setRunId(null);
    setRunDead(false);
  }

  async function handleInjectFault(type: string, severity: number, cylinder?: number) {
    if (!runId) return;
    await api.injectFault(runId, type, severity, 0, cylinder);
  }

  async function handleClearFaults() {
    if (!runId) return;
    await api.clearFaults(runId);
  }

  // Point 7: Instant skeleton loader instead of slow blank text
  if (loadingEngine) {
    return (
      <main className="console" style={{ padding: "28px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
          <div className="skeleton-box" style={{ width: "120px", height: "36px", borderRadius: "8px" }} />
          <div className="skeleton-box" style={{ width: "200px", height: "36px", borderRadius: "8px" }} />
        </div>
        <div className="skeleton-box" style={{ width: "100%", height: "200px", borderRadius: "12px", marginBottom: "20px" }} />
        <div className="skeleton-box" style={{ width: "100%", height: "320px", borderRadius: "12px" }} />
      </main>
    );
  }

  if (!engine) {
    return (
      <main className="console">
        <Link href="/fleet" className="btn-back-action">
          ← Back to Fleet
        </Link>
        <div className="empty-state" style={{ marginTop: "24px" }}>
          Engine not found. Is the backend seeded? (<code>npm run seed</code> in <code>server/</code>)
        </div>
      </main>
    );
  }

  const frame = twin.latest;

  return (
    <main className="console">
      <header className="console-header">
        <Link href="/fleet" className="btn-icon" aria-label="Back to fleet register">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </Link>

        <div className="console-ident">
          <h1 className="console-tail">{engine.tail}</h1>
          <span className="console-model">{engine.model.toUpperCase()}</span>
        </div>

        {frame && <span className="chip is-accent">{frame.phase.toUpperCase()}</span>}

        <span className="spacer" />

        {frame && (
          <div className="console-ehi" title="Engine health index — condition now">
            <span
              className={`console-ehi-num is-${
                frame.health.ehi === null
                  ? "unknown"
                  : frame.health.ehi < 50
                    ? "critical"
                    : frame.health.ehi < 70
                      ? "caution"
                      : "ok"
              }`}
            >
              {frame.health.ehi === null ? "—" : Math.round(frame.health.ehi)}
            </span>
            <span className="console-ehi-cap">EHI</span>
          </div>
        )}

        {runId && (
          <span className={`chip ${twin.status === "live" ? "is-ok" : twin.status === "degraded" ? "is-critical" : ""}`}>
            <span className="chip-dot" />
            {twin.status.toUpperCase()}
          </span>
        )}

        <Link href={`/uav/${engineId}/twin3d`} className="btn-secondary">
          3D twin
        </Link>
      </header>

      {/* Point 3: Default 3D Engine View embedded in Console Page! */}
      <MiniTwinPreview engineId={engineId} frame={frame} />

      {!runId ? (
        <>
          <div className="panel">
            <ControlBar
              runId={runId}
              injected={[]}
              onStart={handleStart}
              onStop={handleStop}
              onInjectFault={handleInjectFault}
              onClearFaults={handleClearFaults}
            />
          </div>
          <div className="empty-state" style={{ marginTop: 14 }}>
            No active sortie for {engine.tail}. Start one above to bring live physics and ML diagnostics online.
          </div>
        </>
      ) : !frame ? (
        <>
          <div className="panel">
            <ControlBar
              runId={runId}
              injected={[]}
              onStart={handleStart}
              onStop={handleStop}
              onInjectFault={handleInjectFault}
              onClearFaults={handleClearFaults}
            />
          </div>

          {/* Point 7: Interactive Telemetry Connection Card */}
          <div
            className="empty-state"
            style={{
              marginTop: 14,
              padding: "24px",
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            {runDead ? (
              <>
                <div style={{ color: "var(--critical)", fontWeight: 700, fontSize: "14px" }}>
                  Sortie process is no longer active on the server.
                </div>
                <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--ink-2)" }}>
                  It was likely ended by a server restart. Stop it to clear the console, then start a new one.
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", fontWeight: 700, fontSize: "14px" }}>
                  <span className="status-dot" />
                  <span>Connecting to the live 1 Hz telemetry stream</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--ink-3)" }}>
                  Simulator socket handshake in progress. Telemetry frame will appear in seconds.
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="console-dashboard">
          <div className="console-col-left">
            <MissionStatus mission={frame.mission} />

            <div className="decision-card">
              <div className="decision-grid">
                <div className="decision-section">
                  <h3 className="panel-subhead">Operational Limiters</h3>
                  <LimiterList limiters={frame.mission.limiters} />
                </div>
                <div className="decision-section">
                  <h3 className="panel-subhead">Power Derate Planner</h3>
                  <WhatIfPlanner mission={frame.mission} runId={runId} />
                </div>
              </div>
            </div>
          </div>

          <div className="console-col-right">
            <DetailTabs frame={frame} runId={runId} />

            {/* Scenario controls */}
            <div className="panel panel-controls">
              <ControlBar
                runId={runId}
                injected={frame.injectedFaults}
                onStart={handleStart}
                onStop={handleStop}
                onInjectFault={handleInjectFault}
                onClearFaults={handleClearFaults}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
