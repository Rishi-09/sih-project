"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  onOpenGuide?: () => void;
  onOpenTutorial?: () => void;
}

export function Sidebar({ onOpenGuide, onOpenTutorial }: Props) {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isFleet = pathname === "/fleet" || pathname.startsWith("/uav");
  const is3DTwin = pathname.includes("/twin3d");

  return (
    <aside className="app-sidebar">
      {/* Prominent Logo & Brand (Outside navbar, big and prominent - Point 16) */}
      <div className="sidebar-brand">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/drdo-logo.png" alt="DRDO" style={{ width: "36px", height: "36px", objectFit: "contain" }} />
          <div className="brand-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2" />
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
        </div>
        <div className="brand-text">
          <div className="brand-title">
            <span>RETRIBUTION</span>
            <span className="brand-tag">TWIN</span>
          </div>
          <span className="brand-subtitle">ROTAX 915 iS UAV FLEET</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Command Center</div>

        <Link href="/" className={`nav-link-item ${isHome ? "active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          <span>Dashboard</span>
        </Link>

        <Link href="/fleet" className={`nav-link-item ${isFleet && !is3DTwin ? "active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
          </svg>
          <span>Aircraft Fleet</span>
        </Link>

        <Link href="/uav/uav-01/twin3d" className={`nav-link-item ${is3DTwin ? "active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
            <path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" />
          </svg>
          <span>3D Digital Twin</span>
          <span className="nav-badge-pill">3D</span>
        </Link>

        <div className="nav-section-label" style={{ marginTop: 14 }}>Intelligence</div>

        <Link href="/fleet" className="nav-link-item">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Alerts & Faults</span>
          <span className="nav-badge-dot" />
        </Link>

        <Link href="/fleet" className="nav-link-item">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
          <span>Telemetry Stream</span>
          <span className="nav-badge-pill" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#34d399" }}>
            Live
          </span>
        </Link>
      </nav>

      {/* Quick Action Card & User Info */}
      <div className="sidebar-footer">
        <div className="quick-action-card">
          <div className="quick-card-title">
            <span>🎓</span> Learn The System
          </div>
          <div className="quick-card-desc">
            Interactive scenarios explaining all buttons, gauges & tactical decisions.
          </div>
          <button
            type="button"
            className="btn-quick-launch"
            style={{
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.35) 100%)",
              borderColor: "rgba(16, 185, 129, 0.4)",
              color: "#6ee7b7",
              marginBottom: "8px",
            }}
            onClick={onOpenTutorial}
          >
            <span>Interactive Tutorial</span>
            <span>→</span>
          </button>
          <button
            type="button"
            className="btn-quick-launch"
            onClick={onOpenGuide}
          >
            <span>Operator Guide</span>
            <span>→</span>
          </button>
        </div>

        <div className="user-profile-strip">
          <div className="user-avatar">FL</div>
          <div className="user-info">
            <span className="user-name">Flight Commander</span>
            <span className="user-role">MALE UAV Ops Node</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
