"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EngineSummary } from "@/lib/types";
import { api } from "@/lib/api";
import { useTwinSocket } from "@/lib/socket";
import { Twin3DCanvas } from "@/components/twin3d/Twin3DCanvas";
import { SimulatorPanel } from "@/components/twin3d/SimulatorPanel";
import { MLPredictionPanel } from "@/components/twin3d/MLPredictionPanel";
import { LogPanel } from "@/components/twin3d/LogPanel";
import { Twin3DLayout } from "@/components/twin3d/Twin3DLayout";
import { ControlBar } from "@/components/ControlBar";
import "./twin3d.css";

function ehiClass(ehi: number | null | undefined): string {
  // null/undefined = not yet assessed. Neutral, deliberately not green.
  if (ehi === null || ehi === undefined) return "unknown";
  if (ehi < 50) return "crit";
  if (ehi < 80) return "warn";
  return "";
}

export default function Twin3DPage() {
  const params = useParams<{ engineId: string }>();
  const engineId = params.engineId;

  const [engine, setEngine] = useState<EngineSummary | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(true);
  // The fault controls get their own strip below the header rather than being
  // squeezed into it. The header is a fixed-height, non-wrapping flex row, so
  // anything taller than one line was being clipped behind the workspace —
  // which is what hid the active-fault chips entirely.
  const [showFaultBar, setShowFaultBar] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .engines()
      .then((engines) => {
        if (cancelled) return;
        const e = engines.find((x) => x.id === engineId) ?? null;
        setEngine(e);
        if (e?.latestRunStatus === "live" || e?.latestRunStatus === "degraded") {
          setRunId(e.latestRunId);
        }
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

  async function handleClearFaults() {
    if (!runId) return;
    await api.clearFaults(runId);
  }

  async function handleInjectFault(type: string, severity: number, cylinder?: number) {
    if (!runId) return;
    await api.injectFault(runId, type, severity, 0, cylinder);
  }

  if (loadingEngine) {
    return (
      <main className="twin3d-page">
        <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>
          Loading 3D Twin Workspace…
        </div>
      </main>
    );
  }

  if (!engine) {
    return (
      <main className="twin3d-page">
        <div style={{ padding: 40, textAlign: "center" }}>
          <Link href="/" className="btn">
            ← Back to Fleet
          </Link>
          <p style={{ marginTop: 20, color: "var(--ink-3)" }}>
            Engine not found. Verify backend status or run <code>npm run seed</code>.
          </p>
        </div>
      </main>
    );
  }

  const injected = twin.latest?.injectedFaults ?? [];

  return (
    <div className="twin3d-page">
      {/* Top IDE Bar */}
      <header className="twin3d-topbar">
        <Link href={`/uav/${engineId}`} className="back-btn">
          ← 2D Console
        </Link>
        <div className="topbar-tail">
          <span>{engine.tail}</span>
          <span className="topbar-engine-model">[{engine.model}]</span>
        </div>

        {twin.latest && (
          <div className="phase-pill" style={{ marginLeft: 8 }}>
            {twin.latest.phase}
          </div>
        )}

        <div className="topbar-spacer" />

        {/* Fault state stays visible in the header even with the strip closed,
            so the count is never hidden behind a collapsed panel. */}
        <button
          className={`faultbar-toggle ${injected.length > 0 ? "armed" : ""}`}
          onClick={() => setShowFaultBar((v) => !v)}
          aria-expanded={showFaultBar}
        >
          {injected.length > 0 ? `${injected.length} FAULT${injected.length > 1 ? "S" : ""}` : "NOMINAL"}
          <span className="faultbar-caret">{showFaultBar ? "▴" : "▾"}</span>
        </button>

        {runId && (
          <span className={`conn-status conn-${twin.status}`} style={{ marginLeft: 8 }}>
            {twin.status}
          </span>
        )}

        {twin.latest && (
          <div className={`ehi-ring ${ehiClass(twin.latest.health.ehi)}`} style={{ width: 36, height: 36, fontSize: 12, marginLeft: 8 }}>
            {twin.latest.health.ehi === null ? "—" : Math.round(twin.latest.health.ehi)}
          </div>
        )}
      </header>

      {/* Fault / scenario strip — its own row in the page's flex column, so it
          takes real height and pushes the workspace down instead of overflowing
          the fixed-height header. */}
      {showFaultBar && (
        <div className="twin3d-faultbar">
          <ControlBar
            runId={runId}
            injected={injected}
            onStart={handleStart}
            onStop={handleStop}
            onInjectFault={handleInjectFault}
            onClearFaults={handleClearFaults}
          />
        </div>
      )}

      {/* Main 4-Panel IDE View */}
      <Twin3DLayout
        leftPanel={<SimulatorPanel frame={twin.latest} />}
        centerCanvas={<Twin3DCanvas frame={twin.latest} />}
        rightPanel={<MLPredictionPanel frame={twin.latest} />}
        bottomLog={<LogPanel frame={twin.latest} />}
      />
    </div>
  );
}
