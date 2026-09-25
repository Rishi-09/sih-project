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

/**
 * Operator console, organised by DECISION rather than by data source.
 *
 * Three levels, in the order an operator reads them:
 *   1. Can this sortie finish, and what should I do?   (MissionStatus)
 *   2. What is consuming the margin, and what would   (LimiterList,
 *      backing off power buy me?                       WhatIfPlanner)
 *   3. Everything else, one tab at a time.             (DetailTabs)
 *
 * The previous layout put all of level 3 on screen permanently — 19 sensor
 * tiles, subsystem scores, probability bars, alerts and a chat box side by side
 * — and left the operator to work out which numbers mattered. Nothing has been
 * removed; it has been ranked.
 */
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

  // A run can be recorded as live in the database while the process that owned
  // it is gone (a server restart drops the in-memory run). The console would
  // then subscribe and sit on "Waiting for telemetry…" indefinitely. Ask the
  // server whether the run is live in THIS process, and say so if it is not.
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
    // Clear locally even if the server 404s. A run the server has already
    // forgotten is exactly the case where the operator most needs Stop to work.
    try {
      await api.stopRun(runId);
    } catch {
      /* already gone server-side — nothing to stop */
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

  if (loadingEngine) return <main className="console">Loading…</main>;
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
        <Link href="/" className="back">
          ← Fleet
        </Link>
        <div className="tail">{engine.tail}</div>
        {frame && <div className="phase-pill">{frame.phase}</div>}
        <div className="spacer" />
        {/* Engine health is deliberately secondary to mission reliability here.
            It answers "how degraded is the engine", which is a maintenance
            question; the headline answers "will this sortie finish", which is
            the operator's. */}
        {frame && (
          <div className="ehi-chip" title="Engine health index — condition now, not mission outcome">
            {/* Dash, not 100: before the backend's first health evaluation
                there is no index, and a filled-in perfect score would be the
                most misleading possible placeholder on a health monitor. */}
            <span className="ehi-num">{frame.health.ehi === null ? "—" : Math.round(frame.health.ehi)}</span>
            <span className="ehi-cap">health</span>
          </div>
        )}
        {runId && <span className={`conn-status conn-${twin.status}`}>{twin.status}</span>}
        <Link href={`/uav/${engineId}/twin3d`} className="btn btn-quiet">
          3D twin
        </Link>
      </header>

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
          <div className="empty-state">No active sortie for {engine.tail}. Start one above to bring the twin live.</div>
        </>
      ) : !frame ? (
        <>
          {/* Controls stay on screen while waiting. Putting them inside the
              has-a-frame branch meant a run that never produced telemetry left
              the operator with no Stop and no Start — a dead end reachable
              just by restarting the server. */}
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
          <div className="empty-state">
            {runDead ? (
              <>
                <div>This sortie is no longer running on the server.</div>
                <div style={{ fontSize: 12.5, marginTop: 8 }}>
                  It was most likely ended by a server restart. Stop it to clear the console, then start a new one.
                </div>
              </>
            ) : (
              "Waiting for telemetry…"
            )}
          </div>
        </>
      ) : (
        <>
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

          {/* Scenario controls last: they drive the demo, not the decision. */}
          <div className="panel panel-controls">
            {/* injected comes straight off the telemetry frame — the backend's
                own ledger of what is active, so the chips confirm the command
                landed rather than echoing local hope. */}
            <ControlBar
              runId={runId}
              injected={frame.injectedFaults}
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
