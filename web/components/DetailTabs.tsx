"use client";

import { useState } from "react";
import { TickFrame } from "@/lib/types";
import { SensorGrid } from "./SensorGrid";
import { DiagnosisPanel } from "./DiagnosisPanel";
import { AlertsPanel } from "./AlertsPanel";
import { AiPanel } from "./AiPanel";

/**
 * Level two of the console.
 *
 * Everything here used to be on screen simultaneously — 19 sensor tiles, 8
 * subsystem scores, 8 probability bars, the alert list and a chat box, all at
 * once, all at the same visual weight. Each is genuinely useful when you go
 * looking for it and pure noise when you are not, which is exactly what a tab
 * is for. One is visible at a time and the operator chooses which.
 *
 * Alerts are the exception to "hidden by default": the tab carries a count
 * badge so an open alert is visible without opening anything, and it is
 * selected on arrival when one is already open.
 */

type Tab = "alerts" | "telemetry" | "diagnosis" | "advisory";

export function DetailTabs({ frame, runId }: { frame: TickFrame; runId: string }) {
  const alertCount = frame.alerts.length;
  const [tab, setTab] = useState<Tab>(alertCount > 0 ? "alerts" : "telemetry");

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "alerts", label: "Alerts", badge: alertCount || undefined },
    { id: "telemetry", label: "Telemetry" },
    { id: "diagnosis", label: "Diagnosis" },
    { id: "advisory", label: "Advisory" },
  ];

  return (
    <section className="details">
      <div className="tabbar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge !== undefined && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="tabpanel" role="tabpanel">
        {tab === "alerts" && <AlertsPanel alerts={frame.alerts} />}
        {tab === "telemetry" && <SensorGrid frame={frame} />}
        {tab === "diagnosis" && <DiagnosisPanel frame={frame} />}
        {tab === "advisory" && <AiPanel runId={runId} />}
      </div>
    </section>
  );
}
