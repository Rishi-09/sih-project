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
import { QuickMetricsStrip } from "@/components/QuickMetricsStrip";

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

  if (loadingEngine) {
    return <main className="console">Loading telemetry...</main>;
  }

  if (!engine) {
    return (
      <main className="console">
        <Link href="/" className="back">
          ← Fleet
        </Link>
        <div className="empty-state">
          Engine not found. Is the backend seeded? (<code>npm run seed</code> in <code>server/</code>)
        </div>
      </main>
    );
  }

  const frame = twin.latest;

  return (
    <main className="console">
      <header className="console-header">
        <Link href="/" className="drdo-topbar-link" title="Return to DRDO Fleet Command">
          <img src="/drdo-logo.png" alt="DRDO Emblem" className="drdo-topbar-img" />
        </Link>
        <Link href="/" className="back">
          ← Fleet
        </Link>
        <div className="tail">{engine.tail}</div>
        {frame && <div className="phase-pill">{frame.phase}</div>}
        <div className="spacer" />

        {frame && (
          <div className="ehi-chip" title="Engine health index">
            <span className="ehi-num">{frame.health.ehi === null ? "—" : `${Math.round(frame.health.ehi)}%`}</span>
            <span className="ehi-cap">Health</span>
          </div>
        )}
        {runId && <span className={`conn-status conn-${twin.status}`}>{twin.status}</span>}
        {runId && (
          <button
            type="button"
            className="btn btn-danger-mini"
            onClick={handleStop}
            title="Terminate active sortie"
          >
            End Sortie
          </button>
        )}
        <Link href={`/uav/${engineId}/twin3d`} className="btn btn-twin3d-nav" title="Switch to 3D Digital Twin View">
          ⬢ 3D Digital Twin
        </Link>
      </header>

      {/* Real telemetry metrics bus */}
      <QuickMetricsStrip frame={frame} tail={engine.tail} />

      {!runId ? (
        <div className="empty-state-card">
          <div className="empty-state-title">Sortie Standby</div>
          <div className="empty-state-sub">
            No active flight sortie running for {engine.tail}. Launch telemetry to monitor live digital twin.
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleStart("S1")}
            style={{ marginTop: 14 }}
          >
            Launch Sortie (Cruise)
          </button>
        </div>
      ) : !frame ? (
        <div className="empty-state-card">
          <div className="empty-state-title">
            {runDead ? "Sortie Terminated" : "Connecting to Live Telemetry…"}
          </div>
          <div className="empty-state-sub">
            {runDead ? "This sortie is no longer active on the server." : "Awaiting telemetry stream at 20 Hz…"}
          </div>
          {runDead && (
            <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "center" }}>
              <button type="button" className="btn" onClick={handleStop}>Clear Sortie</button>
              <button type="button" className="btn btn-primary" onClick={() => handleStart("S1")}>Start New Sortie</button>
            </div>
          )}
        </div>
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
          </div>
        </div>
      )}
    </main>
  );
}
