"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { AiScanModal } from "./AiScanModal";

interface Props {
  onOpenGuide?: () => void;
}

function pageMeta(pathname: string): { title: string; sub: string } {
  if (pathname === "/") {
    return { title: "Fleet Command", sub: "ROTAX 915 iS · MALE UAV FLEET · SECTOR 4" };
  }
  if (pathname === "/fleet") {
    return { title: "Fleet Register", sub: "AIRFRAME STATUS · BINDING LIMITERS · MAINTENANCE QUEUE" };
  }
  if (pathname.includes("/twin3d")) {
    return { title: "3D Digital Twin", sub: "ROTAX 915 iS · FAULT OVERLAY" };
  }
  if (pathname.startsWith("/uav/")) {
    return { title: "Engine Console", sub: "LIVE TELEMETRY · RESIDUALS · MISSION RELIABILITY" };
  }
  if (pathname.startsWith("/twin2")) {
    return { title: "Telemetry Stream", sub: "PHYSICS TWIN · RAW CHANNELS" };
  }
  return { title: "Operations", sub: "RETRIBUTION AERO TWIN" };
}

export function TopBar({ onOpenGuide }: Props) {
  const pathname = usePathname();
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [clock, setClock] = useState<string | null>(null);

  // Rendered only after mount: a server-rendered clock guarantees a hydration
  // mismatch, since the two instants are never the same.
  useEffect(() => {
    const tick = () => setClock(`${new Date().toISOString().slice(11, 19)}Z`);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const { title, sub } = pageMeta(pathname);

  return (
    <>
      <header className="app-topbar">
        <div className="topbar-titles">
          <h1 className="topbar-title">{title}</h1>
          <span className="topbar-sub">{sub}</span>
        </div>

        <div className="topbar-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="text" placeholder="Search tail, channel, fault code" readOnly />
          <span className="topbar-kbd">⌘K</span>
        </div>

        <div className="topbar-clock">
          <span className="status-dot" />
          <span>{clock ?? "--:--:--Z"}</span>
        </div>

        <button type="button" className="btn-icon" onClick={onOpenGuide} aria-label="Operator guide">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 17h.01" />
          </svg>
        </button>

        <button type="button" className="btn-icon" aria-label="Alerts">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
            <path d="M13.7 20a2 2 0 0 1-3.4 0" />
          </svg>
          <span className="notif-dot" />
        </button>

        <button type="button" className="btn-primary" onClick={() => setScanModalOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v4M12 17v4M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
          <span>Run scan</span>
        </button>
      </header>
      <AiScanModal isOpen={scanModalOpen} onClose={() => setScanModalOpen(false)} />
    </>
  );
}
