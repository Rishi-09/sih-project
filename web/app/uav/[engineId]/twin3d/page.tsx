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
import { SortieModalPopup } from "@/components/SortieModalPopup";
import { FaultInjectorDrawer } from "@/components/FaultInjectorDrawer";
import "./twin3d.css";

function ehiClass(ehi: number | null | undefined): string {
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
  const [showFaultBar, setShowFaultBar] = useState(false);
  const [showFaultDrawer, setShowFaultDrawer] = useState(false);
  const [showSortieModal, setShowSortieModal] = useState(false);
  const [hasPromptedModal, setHasPromptedModal] = useState(false);

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
        } else {
          // Point 4: Prompt modal if sortie is not running
          if (!hasPromptedModal) {
            setShowSortieModal(true);
            setHasPromptedModal(true);
          }
        }
      })
      .finally(() => !cancelled && setLoadingEngine(false));

    return () => {
      cancelled = true;
    };
  }, [engineId, hasPromptedModal]);

  const twin = useTwinSocket(runId);

  async function handleStart(scenario: string) {
    const { runId: newRunId } = await api.startRun(engineId, scenario);
    setRunId(newRunId);
    setShowSortieModal(false);
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
    if (!runId) {
      alert("Please start a sortie first before injecting faults into the live flight simulator.");
      return;
    }
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
          <Link href="/fleet" className="btn-back-action">
            ← Back to Fleet
          </Link>
          <p style={{ marginTop: 20, color: "var(--ink-3)" }}>
            Engine not found. Verify backend status.
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
        <Link href={`/uav/${engineId}`} className="btn-secondary" style={{ height: 28, padding: "0 12px", fontSize: 12 }}>
          2D console
        </Link>

        <div className="topbar-tail">
          <span>{engine.tail}</span>
          <span className="topbar-engine-model">Rotax 915 iS Turbo</span>
        </div>

        <div className="topbar-spacer" />

        {/* One status readout: connection state and fault count in the same pill,
            rather than a phase pill, a status pill and a conn badge saying
            overlapping things. */}
        <div className={`status-pill ${injected.length > 0 ? "status-pill-fault" : runId ? "status-pill-nominal" : "status-pill-idle"}`}>
          <span className="status-pill-dot" />
          <span>
            {injected.length > 0
              ? `${injected.length} active fault${injected.length > 1 ? "s" : ""}`
              : runId
                ? twin.status === "live"
                  ? "Nominal · live"
                  : `Nominal · ${twin.status}`
                : "No sortie"}
          </span>
        </div>

        {runId ? (
          <button type="button" className="btn-secondary" style={{ height: 28, fontSize: 12 }} onClick={() => setShowFaultDrawer(true)}>
            Inject fault
            {injected.length > 0 && <span className="fault-count">{injected.length}</span>}
          </button>
        ) : (
          <button type="button" className="btn-primary" style={{ height: 28, fontSize: 12 }} onClick={() => handleStart("S1")}>
            Launch sortie
          </button>
        )}

        <button
          type="button"
          className="btn-scenario-toggle"
          onClick={() => setShowFaultBar((v) => !v)}
          aria-expanded={showFaultBar}
          title="Toggle the scenario simulator bar"
        >
          <span>Sortie controls</span>
          <span className="faultbar-caret">{showFaultBar ? "▴" : "▾"}</span>
        </button>

        {twin.latest && (
          <div className={`ehi-ring ${ehiClass(twin.latest.health.ehi)}`} style={{ width: 32, height: 32, fontSize: 11.5 }}>
            {twin.latest.health.ehi === null ? "—" : Math.round(twin.latest.health.ehi)}
          </div>
        )}
      </header>

      {/* Fault / scenario strip */}
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

      {/* Main 4-Panel IDE View with Resizable Split Columns (Point 9) */}
      <Twin3DLayout
        leftPanel={<SimulatorPanel frame={twin.latest} />}
        centerCanvas={<Twin3DCanvas frame={twin.latest} isFlightActive={Boolean(runId)} />}
        rightPanel={<MLPredictionPanel frame={twin.latest} />}
        bottomLog={<LogPanel frame={twin.latest} />}
      />

      {/* Point 4: No Sortie Warning Popup */}
      <SortieModalPopup
        isOpen={showSortieModal && !runId}
        engineTail={engine.tail}
        engineId={engineId}
        onStartSortie={() => handleStart("S1")}
        onDismiss={() => setShowSortieModal(false)}
      />

      {/* Point 10: Fault Injector Drawer */}
      <FaultInjectorDrawer
        isOpen={showFaultDrawer}
        onClose={() => setShowFaultDrawer(false)}
        injectedFaults={injected}
        onInject={async (type, sev) => {
          await handleInjectFault(type, sev);
        }}
        onClear={handleClearFaults}
      />
    </div>
  );
}
