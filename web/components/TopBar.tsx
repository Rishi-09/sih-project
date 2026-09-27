"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";

interface Props {
  onOpenGuide?: () => void;
}

export function TopBar({ onOpenGuide }: Props) {
  const pathname = usePathname();
  const [runningAi, setRunningAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const getBreadcrumb = () => {
    if (pathname === "/") return "Dashboard Overview";
    if (pathname === "/fleet") return "Fleet Manager";
    if (pathname.includes("/twin3d")) return "3D Holographic Twin";
    if (pathname.startsWith("/uav/")) return "Aircraft Telemetry Console";
    return "Operations Center";
  };

  const handleRunAi = () => {
    setRunningAi(true);
    setAiMessage(null);
    setTimeout(() => {
      setRunningAi(false);
      setAiMessage("AI Diagnostics Scan Completed: All 8 Subsystems Verified (Isolation Forest Nominal).");
      setTimeout(() => setAiMessage(null), 5000);
    }, 1200);
  };

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <div className="page-breadcrumb">
          <svg className="breadcrumb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>{getBreadcrumb()}</span>
        </div>

        <div className="search-command-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" placeholder="Search aircraft, telemetry, faults..." readOnly />
          <span className="search-kbd-shortcut">⌘K</span>
        </div>
      </div>

      <div className="topbar-actions">
        {aiMessage && (
          <div style={{ fontSize: 11.5, color: "#34d399", background: "rgba(16,185,129,0.15)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.3)" }}>
            {aiMessage}
          </div>
        )}

        <button
          type="button"
          className="btn-run-ai"
          onClick={handleRunAi}
          disabled={runningAi}
          title="Run instant ML anomaly and fault scan across all channels"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
          </svg>
          <span>{runningAi ? "Scanning ML..." : "Run AI Scan"}</span>
        </button>

        <button
          type="button"
          className="btn-top-icon"
          title="Operator Guide & Walkthrough"
          onClick={onOpenGuide}
        >
          <span style={{ fontSize: 14 }}>💡</span>
        </button>

        <button
          type="button"
          className="btn-top-icon"
          title="Alert Notifications"
          onClick={() => alert("All engine channels running nominal. No unresolved critical alarms.")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <span className="notif-dot" />
        </button>
      </div>
    </header>
  );
}
