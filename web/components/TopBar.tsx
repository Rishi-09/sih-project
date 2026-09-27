"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";

import { AiScanModal } from "./AiScanModal";

interface Props {
  onOpenGuide?: () => void;
  onOpenTutorial?: () => void;
}

export function TopBar({ onOpenGuide, onOpenTutorial }: Props) {
  const pathname = usePathname();
  const [scanModalOpen, setScanModalOpen] = useState(false);

  const getBreadcrumb = () => {
    if (pathname === "/") return "Dashboard Overview";
    if (pathname === "/fleet") return "Fleet Manager";
    if (pathname.includes("/twin3d")) return "3D Holographic Twin";
    if (pathname.startsWith("/uav/")) return "Aircraft Telemetry Console";
    return "Operations Center";
  };

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-left">
          {/* DRDO Emblem Logo */}
          <div className="topbar-drdo-badge" title="Defence Research and Development Organisation (DRDO)">
            <img src="/drdo-logo.png" alt="DRDO" className="drdo-topbar-logo" />
            <div className="drdo-badge-text">
              <span className="drdo-org-name">DRDO</span>
              <span className="drdo-sub-title">RETRIBUTION</span>
            </div>
          </div>

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
          {/* Interactive Tutorial Button */}
          <button
            type="button"
            className="btn-run-ai"
            style={{
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)",
              borderColor: "rgba(16, 185, 129, 0.45)",
              color: "#6ee7b7",
            }}
            onClick={onOpenTutorial}
            title="Launch Interactive Tutorial Scenario (Buttons, Gauges & Decision Training)"
          >
            <span style={{ fontSize: "13px" }}>🎓</span>
            <span>Tutorial</span>
          </button>

          <button
            type="button"
            className="btn-run-ai"
            onClick={() => setScanModalOpen(true)}
            title="Run instant ML anomaly and fault scan across all channels"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
            </svg>
            <span>Run AI Scan</span>
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
      <AiScanModal isOpen={scanModalOpen} onClose={() => setScanModalOpen(false)} />
    </>
  );
}
