"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrimaryEngineId } from "@/lib/useEngineId";

interface Props {
  onOpenGuide?: () => void;
}

const BrandMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2.4" />
    <path d="M12 9.6V3.4M12 14.4v6.2M9.9 10.8 4.5 7.7M14.1 13.2l5.4 3.1M9.9 13.2l-5.4 3.1M14.1 10.8l5.4-3.1" />
  </svg>
);

const IconCommand = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="8" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="11" width="7" height="10" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const IconFleet = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  </svg>
);

const IconConsole = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v4.5l3 2" />
  </svg>
);

const IconTwin = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </svg>
);

const IconDiagnostics = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13h3.5l2-6 3 12 2.5-8 1.7 4H21" />
  </svg>
);

const IconReliability = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.2 20 6.4v5.3c0 4.6-3.2 8.2-8 9.1-4.8-.9-8-4.5-8-9.1V6.4z" />
    <path d="m9.2 12.1 2 2 3.6-3.9" />
  </svg>
);

const IconAlerts = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" />
    <path d="M12 9.5v4M12 17h.01" />
  </svg>
);

const IconTelemetry = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a15 15 0 0 0 0 18 15 15 0 0 0 0-18M3 12h18" />
  </svg>
);

/** Uplink bar heights, fixed so the strip never re-renders differently on the server. */
const UPLINK_BARS = [38, 55, 44, 72, 61, 88, 70, 100];

export function Sidebar({ onOpenGuide }: Props) {
  const pathname = usePathname();
  const engineId = usePrimaryEngineId();

  // Until an engine id is known, the engine-scoped links go to the register
  // rather than to a guessed id that would 404.
  const consoleHref = engineId ? `/uav/${engineId}` : "/fleet";
  const twinHref = engineId ? `/uav/${engineId}/twin3d` : "/fleet";

  const isHome = pathname === "/";
  const isFleet = pathname === "/fleet";
  const is3DTwin = pathname.includes("/twin3d");
  const isConsole = pathname.startsWith("/uav") && !is3DTwin;

  // The dashboard gets the full rail; every working page trades it for the
  // 64px icon rail, which hands ~170px back to the telemetry.
  if (!isHome) {
    return (
      <nav className="app-sidebar is-rail" aria-label="Primary">
        <Link href="/" className="brand-mark" aria-label="Retribution Twin — fleet command">
          <BrandMark />
        </Link>
        <Link href="/" className="rail-link" aria-label="Fleet command">
          <IconCommand />
        </Link>
        <Link href="/fleet" className={`rail-link ${isFleet ? "active" : ""}`} aria-label="Fleet register">
          <IconFleet />
        </Link>
        <Link href={consoleHref} className={`rail-link ${isConsole ? "active" : ""}`} aria-label="Engine console">
          <IconConsole />
        </Link>
        <Link href={twinHref} className={`rail-link ${is3DTwin ? "active" : ""}`} aria-label="3D digital twin">
          <IconTwin />
        </Link>
        <span className="rail-spacer" />
        <button type="button" className="rail-link" onClick={onOpenGuide} aria-label="Operator guide">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 17h.01" />
          </svg>
        </button>
        <div className="user-avatar">FC</div>
      </nav>
    );
  }

  return (
    <nav className="app-sidebar" aria-label="Primary">
      <div className="sidebar-brand">
        <div className="brand-row">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span className="brand-text">
            <span className="brand-title">RETRIBUTION</span>
            <span className="brand-eyebrow">DRDO · AERO TWIN</span>
          </span>
        </div>
        <div className="sidebar-status">
          <span className="status-dot" />
          <span>ROTAX 915 iS FLEET</span>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="nav-section-label">COMMAND</div>

        <Link href="/" className="nav-link-item active">
          <IconCommand />
          <span>Fleet Command</span>
          <span className="nav-dot" />
        </Link>

        <Link href="/fleet" className="nav-link-item">
          <IconFleet />
          <span>Fleet Register</span>
        </Link>

        <Link href={consoleHref} className="nav-link-item">
          <IconConsole />
          <span>Engine Console</span>
          <span className="nav-badge-pill">LIVE</span>
        </Link>

        <Link href={twinHref} className="nav-link-item">
          <IconTwin />
          <span>3D Digital Twin</span>
        </Link>

        <div className="nav-section-label">INTELLIGENCE</div>

        <Link href={consoleHref} className="nav-link-item">
          <IconDiagnostics />
          <span>Diagnostics</span>
        </Link>

        <Link href={consoleHref} className="nav-link-item">
          <IconReliability />
          <span>Mission Reliability</span>
        </Link>

        <Link href="/fleet" className="nav-link-item">
          <IconAlerts />
          <span>Alerts &amp; Faults</span>
        </Link>

        <Link href="/twin2" className="nav-link-item">
          <IconTelemetry />
          <span>Telemetry Stream</span>
        </Link>
      </div>

      <div className="sidebar-footer">
        <div className="uplink-card">
          <div className="uplink-head">
            <span>GCS UPLINK</span>
            <span className="uplink-rate">1.0 Hz</span>
          </div>
          <div className="uplink-bars" aria-hidden="true">
            {UPLINK_BARS.map((h, i) => (
              <i
                key={i}
                className="uplink-bar"
                style={{
                  height: `${h}%`,
                  background: i >= 7 ? "var(--accent)" : i >= 5 ? "var(--series-1)" : i >= 3 ? "var(--accent-deep)" : undefined,
                }}
              />
            ))}
          </div>
        </div>

        <button type="button" className="btn-secondary" style={{ width: "100%" }} onClick={onOpenGuide}>
          Operator guide
        </button>

        <div className="user-profile-strip">
          <div className="user-avatar">FC</div>
          <div className="user-info">
            <span className="user-name">Flight Commander</span>
            <span className="user-role">OPS NODE · SECTOR 4</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
