"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { useTwinSocket } from "@/lib/socket";
import { MissionStatus } from "@/components/MissionStatus";
import { LimiterList } from "@/components/LimiterList";
import { WhatIfPlanner } from "@/components/WhatIfPlanner";
import { DetailTabs } from "@/components/DetailTabs";
import { ControlBar } from "@/components/ControlBar";
import { MiniTwinPreview } from "@/components/MiniTwinPreview";
import { StartupEngageConsole } from "@/components/StartupEngageConsole";

export default function ConsolePage() {
  const router = useRouter();
  const params = useParams<{ engineId: string }>();
  const engineId = params.engineId;

  const [engine, setEngine] = useState<EngineSummary | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(true);
  const [forceTelemetryView, setForceTelemetryView] = useState(false);

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
    setForceTelemetryView(false);
    try {
      sessionStorage.setItem(
        "active_sortie",
        JSON.stringify({
          runId: newRunId,
          engineId,
          tail: engine?.tail ?? "UAV",
          startedAt: Date.now(),
        })
      );
    } catch {}
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
    setForceTelemetryView(false);
    try {
      sessionStorage.removeItem("active_sortie");
    } catch {}
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
        {/* Point 12: Prominent Back Button */}
        <Link href="/fleet" className="btn-back-action">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          <span>Fleet Overview</span>
        </Link>

        <div className="tail" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src="/drdo-logo.png" alt="DRDO" style={{ height: "30px", width: "auto", objectFit: "contain" }} />
          <span>{engine.tail}</span>
          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>[{engine.model}]</span>
        </div>

        {frame && <div className="phase-pill">{frame.phase}</div>}
        <div className="spacer" />

        {frame && (
          <div className="ehi-chip" title="Engine health index — condition now">
            <span className="ehi-num">{frame.health.ehi === null ? "—" : Math.round(frame.health.ehi)}</span>
            <span className="ehi-cap">health</span>
          </div>
        )}

        {runId && <span className={`conn-status conn-${twin.status}`}>{twin.status}</span>}

        {/* 3D Twin CTA button */}
        <Link href={`/uav/${engineId}/twin3d`} className="btn-action-twin">
          <span>3D Twin</span>
          <span>◈</span>
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
      ) : runDead ? (
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
          <div
            className="empty-state"
            style={{
              marginTop: 14,
              padding: "24px",
              background: "#131b22",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              borderRadius: "10px",
              textAlign: "center",
            }}
          >
            <div style={{ color: "#f87171", fontWeight: 700, fontSize: "14px" }}>
              Sortie process is no longer active on the server.
            </div>
            <div style={{ fontSize: 12.5, marginTop: 8, color: "#94a3b8" }}>
              It was likely ended by a server restart. Stop it to clear the console, then start a new one.
            </div>
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

          <StartupEngageConsole
            engine={engine}
            runId={runId}
            frame={null}
            onExploreBackground={() => {
              try {
                sessionStorage.setItem(
                  "active_sortie",
                  JSON.stringify({
                    runId,
                    engineId: engine.id,
                    tail: engine.tail,
                    startedAt: Date.now(),
                  })
                );
              } catch {}
              router.push("/fleet");
            }}
          />
        </>
      ) : (frame.phase === "startup" || frame.phase === "taxi") && (frame.injectedFaults?.length ?? 0) === 0 && !forceTelemetryView ? (
        <>
          <div className="panel">
            <ControlBar
              runId={runId}
              injected={frame.injectedFaults ?? []}
              onStart={handleStart}
              onStop={handleStop}
              onInjectFault={handleInjectFault}
              onClearFaults={handleClearFaults}
            />
          </div>

          <StartupEngageConsole
            engine={engine}
            runId={runId}
            frame={frame}
            onExploreBackground={() => {
              try {
                sessionStorage.setItem(
                  "active_sortie",
                  JSON.stringify({
                    runId,
                    engineId: engine.id,
                    tail: engine.tail,
                    startedAt: Date.now(),
                  })
                );
              } catch {}
              router.push("/fleet");
            }}
            onViewTelemetry={() => setForceTelemetryView(true)}
          />
        </>
      ) : (
        <>
          {/* Active Fault Warning Banner */}
          {(frame.injectedFaults?.length ?? 0) > 0 && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.45)",
                borderRadius: "8px",
                padding: "12px 18px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                animation: "fade-in 0.2s ease-out",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>⚠️</span>
                <div>
                  <div style={{ color: "#fca5a5", fontSize: "13px", fontWeight: 700 }}>
                    ACTIVE SIMULATED FAULT: {frame.injectedFaults.map(f => f.replace(/_/g, " ")).join(", ").toUpperCase()}
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "12px" }}>
                    Failure mode is actively distorting cylinder telemetry. Observe limiter margin consumption and AI derate recommendation below.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearFaults}
                style={{
                  background: "#7f1d1d",
                  color: "#fecaca",
                  border: "1px solid rgba(248, 113, 113, 0.4)",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Clear Faults ✕
              </button>
            </div>
          )}

          {/* Toggle back to Warmup if in startup/taxi */}
          {forceTelemetryView && (frame.phase === "startup" || frame.phase === "taxi") && (frame.injectedFaults?.length ?? 0) === 0 && (
            <div
              style={{
                background: "rgba(56, 189, 248, 0.08)",
                border: "1px solid rgba(56, 189, 248, 0.25)",
                borderRadius: "8px",
                padding: "8px 14px",
                marginBottom: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Viewing live telemetry during engine ground warmup.
              </span>
              <button
                type="button"
                onClick={() => setForceTelemetryView(false)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                  color: "#38bdf8",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ← Back to Spooling Checklist
              </button>
            </div>
          )}

          <MissionStatus mission={frame.mission} />

          <div className="grid-evidence">
            <section className="panel">
              <h2>What is consuming the margin</h2>
              <LimiterList limiters={frame.mission.limiters} />
            </section>
            <section className="panel">
              <h2>If we reduce power</h2>
              <WhatIfPlanner mission={frame.mission} runId={runId} />
            </section>
          </div>

          <DetailTabs frame={frame} runId={runId} />

          {/* Scenario controls */}
          <div className="panel panel-controls">
            <ControlBar
              runId={runId}
              injected={frame.injectedFaults ?? []}
              onStart={handleStart}
              onStop={handleStop}
              onInjectFault={handleInjectFault}
              onClearFaults={handleClearFaults}
            />
          </div>
        </>
      )}
    </main>
  );
}
