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
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
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
        {/* Point 12: Prominent Back Button */}
        <Link href={`/uav/${engineId}`} className="btn-back-action" style={{ padding: "5px 12px", fontSize: "12px" }}>
          ← 2D Console
        </Link>

        <div className="topbar-tail" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src="/drdo-logo.png" alt="DRDO" style={{ height: "28px", width: "auto", objectFit: "contain" }} />
          <span>{engine.tail}</span>
          <span className="topbar-engine-model">Rotax 915 iS Turbo</span>
        </div>

        {twin.latest && (
          <div className="phase-pill" style={{ marginLeft: 8 }}>
            {twin.latest.phase}
          </div>
        )}

        <div className="topbar-spacer" />

        {/* Fault state stays visible in the header even with the strip closed */}
        {/* Status pill showing either Nominal or Active Faults */}
        <div className={`status-pill ${injected.length > 0 ? "status-pill-fault" : "status-pill-nominal"}`}>
          <span className="status-pill-dot" />
          <span>{injected.length > 0 ? `${injected.length} Active Fault${injected.length > 1 ? "s" : ""}` : "System Nominal"}</span>
        </div>

        {/* Point 10: Prominent Inject Fault Action Button in 3D Twin Top Bar */}
        <button
          type="button"
          onClick={() => setShowFaultDrawer(true)}
          style={{
            background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
            color: "#ffffff",
            border: "1px solid rgba(245, 158, 11, 0.5)",
            padding: "5px 14px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 2px 8px rgba(217, 119, 6, 0.4)",
            marginRight: "6px",
          }}
        >
          <span>⚡ Inject Fault</span>
          {injected.length > 0 && (
            <span style={{ background: "#ef4444", color: "#fff", fontSize: "10px", padding: "1px 5px", borderRadius: "10px" }}>
              {injected.length}
            </span>
          )}
        </button>

        {/* Quick Simulator Control Toggle */}
        <button
          type="button"
          className="btn-scenario-toggle"
          onClick={() => setShowFaultBar((v) => !v)}
          aria-expanded={showFaultBar}
          title="Toggle full scenario simulator bar"
        >
          <span>Sortie Controls</span>
          <span className="faultbar-caret">{showFaultBar ? "▴" : "▾"}</span>
        </button>

        {runId ? (
          <span className={`conn-status conn-${twin.status}`} style={{ marginLeft: 8 }}>
            {twin.status}
          </span>
        ) : (
          <button
            onClick={() => handleStart("S1")}
            style={{
              background: "#10b981",
              color: "#061016",
              border: "none",
              padding: "4px 10px",
              borderRadius: "5px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              marginLeft: "8px",
            }}
          >
            ▶ Launch Sortie
          </button>
        )}

        {twin.latest && (
          <div className={`ehi-ring ${ehiClass(twin.latest.health.ehi)}`} style={{ width: 34, height: 34, fontSize: 11.5, marginLeft: 8 }}>
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
