"use client";

import React, { useState } from "react";
import Link from "next/link";
import { EngineSummary } from "@/lib/types";
import { AiScanModal } from "./AiScanModal";

interface Props {
  initialEngines: EngineSummary[];
}

export function DashboardOverview({ initialEngines }: Props) {
  const [engines] = useState<EngineSummary[]>(initialEngines);
  const [scanning, setScanning] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [healthScore, setHealthScore] = useState(76);
  const [filterView, setFilterView] = useState("all");
  const [activeTimeTab, setActiveTimeTab] = useState("1D");
  const [tooltipData, setTooltipData] = useState<{
    date: string;
    actual: number;
    predicted: number;
    deviation: string;
    confidence: string;
  } | null>({
    date: "Sep 27, 2026",
    actual: 42,
    predicted: 36,
    deviation: "+17%",
    confidence: "High",
  });

  const handleRunScan = () => {
    setScanning(true);
    setScanModalOpen(true);
    setTimeout(() => {
      setScanning(false);
      setHealthScore(Math.floor(78 + Math.random() * 8));
    }, 1500);
  };

  // Generate 26 segments for the arc gauge like in reference image
  const totalSegments = 26;
  const activeSegments = Math.round((healthScore / 100) * totalSegments);

  const displayEngines = engines.length > 0 ? engines : [
    {
      id: "uav-01",
      tail: "UAV-01",
      model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC",
      ehi: 88,
      latestRunId: "run_sample_1",
      latestRunStatus: "live",
      createdAt: new Date().toISOString(),
    },
    {
      id: "uav-02",
      tail: "UAV-02",
      model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC",
      ehi: 62,
      latestRunId: "run_sample_2",
      latestRunStatus: "degraded",
      createdAt: new Date().toISOString(),
    },
    {
      id: "uav-03",
      tail: "UAV-03",
      model: "Rotax 915 iS, 4-cyl boxer, turbo, FADEC",
      ehi: 94,
      latestRunId: null,
      latestRunStatus: "idle",
      createdAt: new Date().toISOString(),
    },
  ];

  return (
    <div className="dashboard-grid-container">
      {/* ROW 1: System Health & AI Threat Forecast (Directly matching image) */}
      <div className="dashboard-row-top">
        {/* Card 1: System Health */}
        <div className="dash-card">
          <div className="card-header-bar">
            <div className="card-title-cluster">
              <span className="card-title">System Health</span>
            </div>
            <button
              type="button"
              className="card-action-btn"
              onClick={handleRunScan}
              disabled={scanning}
            >
              <span>{scanning ? "Scanning..." : "Run Scan"}</span>
            </button>
          </div>

          {/* Mini metrics: CPU, RAM, Telemetry Rate */}
          <div className="health-mini-metrics">
            <div className="metric-pill">
              <div className="metric-icon-box">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div className="metric-val-wrap">
                <span className="metric-pct">65%</span>
                <span className="metric-lbl">CPU USAGE</span>
              </div>
            </div>

            <div className="metric-pill">
              <div className="metric-icon-box" style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                </svg>
              </div>
              <div className="metric-val-wrap">
                <span className="metric-pct">72%</span>
                <span className="metric-lbl">RAM USAGE</span>
              </div>
            </div>

            <div className="metric-pill">
              <div className="metric-icon-box" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="metric-val-wrap">
                <span className="metric-pct">1 Hz</span>
                <span className="metric-lbl">TELEMETRY</span>
              </div>
            </div>
          </div>

          {/* Semicircular Curved Speedometer Gauge */}
          <div className="gauge-hero-container">
            <svg className="arc-gauge-svg" viewBox="0 0 260 140">
              <defs>
                <filter id="gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              {Array.from({ length: totalSegments }).map((_, i) => {
                const angle = 180 + (i / (totalSegments - 1)) * 180;
                const rad = (angle * Math.PI) / 180;
                const rInner = 82;
                const rOuter = 104;
                const cx = 130;
                const cy = 125;
                const x1 = cx + rInner * Math.cos(rad);
                const y1 = cy + rInner * Math.sin(rad);
                const x2 = cx + rOuter * Math.cos(rad);
                const y2 = cy + rOuter * Math.sin(rad);
                const isLit = i < activeSegments;

                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isLit ? "#34d399" : "rgba(255, 255, 255, 0.08)"}
                    strokeWidth="4"
                    strokeLinecap="round"
                    filter={isLit ? "url(#gauge-glow)" : undefined}
                    style={{
                      transition: "stroke 0.3s ease",
                    }}
                  />
                );
              })}
            </svg>

            <div className="gauge-center-stat">
              <span className="gauge-main-number">{healthScore}%</span>
              <span className="gauge-sub-caption">fleet health index</span>
            </div>

            <div className="gauge-min-max-labels">
              <span>0</span>
              <span>100</span>
            </div>
          </div>

          {/* System Status Checklist */}
          <div className="system-status-grid">
            <div className="status-check-row">
              <span className="status-key">Telemetry Engine:</span>
              <span className="status-val-ok">Active</span>
            </div>
            <div className="status-check-row">
              <span className="status-key">ML Pipeline:</span>
              <span className="status-val-ok">Connected</span>
            </div>
            <div className="status-check-row">
              <span className="status-key">Nominal Regressors:</span>
              <span className="status-val-dim">19 Channels</span>
            </div>
            <div className="status-check-row">
              <span className="status-key">Fault Classifier:</span>
              <span className="status-val-dim">91 States</span>
            </div>
            <div className="status-check-row">
              <span className="status-key">Anomaly Detector:</span>
              <span className="status-val-ok">Isolation Forest</span>
            </div>
            <div className="status-check-row">
              <span className="status-key">Domain Security:</span>
              <span className="status-val-ok">Encrypted</span>
            </div>
          </div>
        </div>

        {/* Card 2: AI Threat Forecast */}
        <div className="dash-card">
          <div className="card-header-bar">
            <div className="card-title-cluster">
              <span style={{ color: "#34d399" }}>✦</span>
              <span className="card-title">AI Threat & Engine Health Forecast</span>
            </div>
            <button
              type="button"
              className="card-action-btn"
              onClick={() => {
                setTooltipData({
                  date: "Live Forecast",
                  actual: Math.floor(38 + Math.random() * 10),
                  predicted: 35,
                  deviation: "+14%",
                  confidence: "High",
                });
              }}
            >
              <span>↺ Refresh</span>
            </button>
          </div>

          {/* Interactive Chart Area */}
          <div className="forecast-chart-box">
            <svg width="100%" height="100%" viewBox="0 0 500 170" preserveAspectRatio="none">
              <defs>
                <linearGradient id="blueGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid lines */}
              <line x1="30" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <line x1="30" y1="70" x2="480" y2="70" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <line x1="30" y1="110" x2="480" y2="110" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <line x1="30" y1="150" x2="480" y2="150" stroke="rgba(255,255,255,0.08)" />

              {/* Y Axis Labels */}
              <text x="10" y="34" fill="#475569" fontSize="10">60</text>
              <text x="10" y="74" fill="#475569" fontSize="10">40</text>
              <text x="10" y="114" fill="#475569" fontSize="10">20</text>
              <text x="15" y="154" fill="#475569" fontSize="10">0</text>

              {/* Predicted Green Dotted Line */}
              <path
                d="M 40 100 L 100 95 L 160 85 L 220 85 L 280 85 L 340 120 L 400 115 L 460 115"
                fill="none"
                stroke="#10b981"
                strokeWidth="2"
                strokeDasharray="4 4"
              />

              {/* Actual Blue Solid Line */}
              <path
                d="M 40 120 L 100 85 L 160 55 L 220 55 L 280 65 L 340 65 L 400 65 L 460 145"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
              />

              {/* Active Inspection Point on line */}
              <circle cx="280" cy="65" r="5" fill="#38bdf8" stroke="#0e1317" strokeWidth="2" />
              <circle cx="280" cy="85" r="4" fill="#10b981" stroke="#0e1317" strokeWidth="2" />
              <line x1="280" y1="30" x2="280" y2="150" stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" />

              {/* X Axis Labels */}
              <text x="40" y="166" fill="#64748b" fontSize="10">Leg 1</text>
              <text x="100" y="166" fill="#64748b" fontSize="10">Climb</text>
              <text x="160" y="166" fill="#64748b" fontSize="10">Cruise</text>
              <text x="220" y="166" fill="#64748b" fontSize="10">Loiter</text>
              <text x="280" y="166" fill="#38bdf8" fontSize="10" fontWeight="bold">Current</text>
              <text x="340" y="166" fill="#64748b" fontSize="10">Descent</text>
              <text x="400" y="166" fill="#64748b" fontSize="10">Approach</text>
              <text x="450" y="166" fill="#64748b" fontSize="10">Land</text>
            </svg>

            {/* Hover Tooltip Box matching image */}
            {tooltipData && (
              <div
                style={{
                  position: "absolute",
                  top: "20px",
                  right: "40px",
                  background: "#162028",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "11px",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.4)",
                  pointerEvents: "none",
                }}
              >
                <div style={{ color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>
                  {tooltipData.date}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#cbd5e1" }}>
                  <span>Actual Stress:</span>
                  <strong style={{ color: "#38bdf8" }}>{tooltipData.actual}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#cbd5e1" }}>
                  <span>Predicted:</span>
                  <strong style={{ color: "#34d399" }}>{tooltipData.predicted}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#cbd5e1" }}>
                  <span>Deviation:</span>
                  <strong style={{ color: "#f59e0b" }}>{tooltipData.deviation}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, color: "#cbd5e1" }}>
                  <span>AI Confidence:</span>
                  <strong style={{ color: "#10b981" }}>{tooltipData.confidence}</strong>
                </div>
              </div>
            )}
          </div>

          {/* AI Insight Callout matching reference image */}
          <div className="ai-insight-callout">
            <span className="insight-sparkle">✦</span>
            <div className="insight-content">
              <span className="insight-bold">AI Insight: </span>
              The nominal digital twin detects elevated temperature deviation in cylinder 3 during high-throttle loiter (+17%).
              Recommend: <Link href="/uav/uav-01" className="insight-link">Inspect FADEC cylinder 3 injector and cooling baffles</Link>.
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: Connected Systems & Sortie Network Activity (Directly matching image) */}
      <div className="dashboard-row-bottom">
        {/* Card 3: Connected Systems (Aircraft Fleet) */}
        <div className="dash-card">
          <div className="card-header-bar">
            <div className="card-title-cluster">
              <span className="card-title">Connected Systems</span>
            </div>
            <select
              value={filterView}
              onChange={(e) => setFilterView(e.target.value)}
              style={{
                background: "#1a242c",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#cbd5e1",
                fontSize: "11.5px",
                padding: "4px 8px",
                borderRadius: "6px",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">View: All aircraft</option>
              <option value="live">View: Active Sorties</option>
            </select>
          </div>

          <div className="connected-table-wrapper">
            <table className="connected-table">
              <thead>
                <tr>
                  <th>AIRCRAFT</th>
                  <th>POWERPLANT</th>
                  <th>HEALTH SCORE</th>
                  <th>DIAGNOSIS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {displayEngines.map((e) => {
                  const score = e.ehi !== null && e.ehi !== undefined ? Math.round(e.ehi) : 92;
                  const isLive = e.latestRunStatus === "live" || e.latestRunStatus === "degraded";

                  return (
                    <tr key={e.id} className="table-row-system">
                      <td>
                        <div className="system-tail-cell">
                          <span className="tail-icon-badge">✈</span>
                          <span>{e.tail}</span>
                        </div>
                      </td>
                      <td style={{ color: "#94a3b8", fontSize: "11.5px" }}>
                        Rotax 915 iS (Turbo)
                      </td>
                      <td>
                        <div className="health-meter-bars">
                          <div className="meter-segments">
                            {Array.from({ length: 10 }).map((_, idx) => {
                              const filled = idx < Math.round(score / 10);
                              return (
                                <div
                                  key={idx}
                                  className={`meter-segment ${
                                    filled
                                      ? score >= 80
                                        ? "active-green"
                                        : score >= 50
                                        ? "active-amber"
                                        : "active-red"
                                      : ""
                                  }`}
                                />
                              );
                            })}
                          </div>
                          <span className="meter-pct-num">{score}%</span>
                        </div>
                      </td>
                      <td>
                        {isLive ? (
                          <span className="threat-tag threat-low">
                            ● Active Live
                          </span>
                        ) : (
                          <span className="threat-tag" style={{ background: "rgba(148,163,184,0.15)", color: "#94a3b8" }}>
                            ○ Standby
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {/* Point 6: Prominent Console Button */}
                          <Link href={`/uav/${e.id}`} className="btn-table-action" style={{ background: "#0ea5e9", color: "#061016" }}>
                            Console →
                          </Link>
                          {/* 3D Twin link */}
                          <Link href={`/uav/${e.id}/twin3d`} className="btn-table-action">
                            3D Twin ◈
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Dedicated Mobile Cards (100% responsive, never overflows screen) */}
          <div className="connected-mobile-list">
            {displayEngines.map((e) => {
              const score = e.ehi !== null && e.ehi !== undefined ? Math.round(e.ehi) : 92;
              const isLive = e.latestRunStatus === "live" || e.latestRunStatus === "degraded";

              return (
                <div key={e.id} className="mobile-system-card">
                  <div className="mobile-card-head">
                    <div className="system-tail-cell">
                      <span className="tail-icon-badge">✈</span>
                      <span style={{ fontSize: "14px", fontWeight: 700 }}>{e.tail}</span>
                    </div>
                    {isLive ? (
                      <span className="threat-tag threat-low">● Active Live</span>
                    ) : (
                      <span className="threat-tag" style={{ background: "rgba(148,163,184,0.15)", color: "#94a3b8" }}>
                        ○ Standby
                      </span>
                    )}
                  </div>

                  <div className="mobile-card-row">
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Powerplant:</span>
                    <span style={{ fontSize: "12px", color: "#e2e8f0" }}>Rotax 915 iS (Turbo)</span>
                  </div>

                  <div className="mobile-card-row" style={{ marginTop: "6px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Health Score:</span>
                    <div className="health-meter-bars">
                      <div className="meter-segments">
                        {Array.from({ length: 10 }).map((_, idx) => {
                          const filled = idx < Math.round(score / 10);
                          return (
                            <div
                              key={idx}
                              className={`meter-segment ${
                                filled
                                  ? score >= 80
                                    ? "active-green"
                                    : score >= 50
                                    ? "active-amber"
                                    : "active-red"
                                  : ""
                              }`}
                            />
                          );
                        })}
                      </div>
                      <span className="meter-pct-num">{score}%</span>
                    </div>
                  </div>

                  <div className="mobile-card-actions">
                    <Link href={`/uav/${e.id}`} className="btn-table-action" style={{ background: "#0ea5e9", color: "#061016", flex: 1, justifyContent: "center" }}>
                      Console →
                    </Link>
                    <Link href={`/uav/${e.id}/twin3d`} className="btn-table-action" style={{ flex: 1, justifyContent: "center" }}>
                      3D Twin ◈
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 4: Network / Sortie Activity Map */}
        <div className="dash-card">
          <div className="card-header-bar">
            <div className="card-title-cluster">
              <span className="card-title">Network Activity</span>
            </div>
            <div className="map-time-tabs" style={{ position: "static" }}>
              {["ALL", "1D", "1W", "1M", "3M"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`map-tab-btn ${activeTimeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTimeTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="map-visual-card">
            {/* Visual radar waypoint circle */}
            <div className="map-marker-pulse" style={{ top: "45%", left: "68%" }}>
              <div className="marker-pulse-ring" />
              <div className="marker-core-icon">✈</div>
            </div>

            {/* Alert badge over map matching reference image */}
            <div className="map-alert-tag">
              <span style={{ fontSize: 13 }}>⚠</span>
              <span>UAV-01 Telemetry Stream Online</span>
            </div>
          </div>
        </div>
      </div>

      <AiScanModal isOpen={scanModalOpen} onClose={() => setScanModalOpen(false)} />
    </div>
  );
}
