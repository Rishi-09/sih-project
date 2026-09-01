"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { useTwinSocket } from "@/lib/socket";
import { SensorGrid } from "@/components/SensorGrid";
import { DiagnosisPanel } from "@/components/DiagnosisPanel";
import { AlertsPanel } from "@/components/AlertsPanel";
import { PrognosisReliability } from "@/components/PrognosisReliability";
import { AiPanel } from "@/components/AiPanel";
import { ControlBar } from "@/components/ControlBar";

function ehiClass(ehi: number | undefined): string {
  if (ehi === undefined) return "";
  if (ehi < 50) return "crit";
  if (ehi < 80) return "warn";
  return "";
}

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

  async function handleStart(scenario: string) {
    const { runId: newRunId } = await api.startRun(engineId, scenario);
    setRunId(newRunId);
  }

  async function handleStop() {
    if (!runId) return;
    await api.stopRun(runId);
    setRunId(null);
  }

  async function handleInjectFault(type: string, severity: number, cylinder?: number) {
    if (!runId) return;
    await api.injectFault(runId, type, severity, 0, cylinder);
  }

  if (loadingEngine) return <main className="console">Loading…</main>;
  if (!engine) {
    return (
      <main className="console">
        <Link href="/" className="back">
          ← Fleet
        </Link>
        <div className="empty-state">Engine not found. Is the backend seeded? (<code>npm run seed</code> in <code>server/</code>)</div>
      </main>
    );
  }

  return (
    <main className="console">
      <div className="console-header">
        <Link href="/" className="back">
          ← Fleet
        </Link>
        <div className="tail">{engine.tail}</div>
        <Link href={`/uav/${engineId}/twin3d`} className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 11 }}>
          ◈ 3D Holographic Twin
        </Link>
        {twin.latest && <div className="phase-pill">{twin.latest.phase}</div>}
        <div className="spacer" />
        {runId && <span className={`conn-status conn-${twin.status}`}>{twin.status}</span>}
        {twin.latest && <div className={`ehi-ring ${ehiClass(twin.latest.health.ehi)}`}>{Math.round(twin.latest.health.ehi)}</div>}
      </div>

      <div className="panel">
        <ControlBar runId={runId} onStart={handleStart} onStop={handleStop} onInjectFault={handleInjectFault} />
      </div>

      {!runId ? (
        <div className="empty-state">
          No active sortie for {engine.tail}. Start one above to bring the twin live.
        </div>
      ) : (
        <div className="grid-main">
          <div>
            <div className="panel">
              <h2>Engine sensors — Rotax 915 iS (19 channels, 4 modeled)</h2>
              <SensorGrid frame={twin.latest} />
            </div>
            <div className="panel">
              <h2>Alerts</h2>
              <AlertsPanel alerts={twin.alerts} />
            </div>
            <div className="panel">
              <h2>Maintenance advisory & chat</h2>
              <AiPanel runId={runId} />
            </div>
          </div>
          <div>
            <div className="panel">
              <h2>Diagnosis</h2>
              <DiagnosisPanel frame={twin.latest} />
            </div>
            <div className="panel">
              <h2>Prognosis & mission reliability</h2>
              <PrognosisReliability frame={twin.latest} runId={runId} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
