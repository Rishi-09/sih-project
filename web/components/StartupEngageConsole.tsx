"use client";

import React from "react";
import Link from "next/link";
import { TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
  engineId: string;
  tail: string;
  onExploreBackground: () => void;
  onViewTelemetry: () => void;
}

export function StartupEngageConsole({ frame, engineId, tail, onExploreBackground, onViewTelemetry }: Props) {
  const currentT = frame ? Math.round(frame.t) : 0;
  const warmupWindowSec = 75;
  const secondsLeft = Math.max(0, warmupWindowSec - currentT);
  const progressPct = Math.min(100, Math.max(2, Math.round((currentT / warmupWindowSec) * 100)));

  const rpm = frame?.sensors?.rpm ?? 0;
  const mapBar = frame?.sensors?.map_bar ?? 0.98;
  const oilPress = frame?.sensors?.oil_press_bar ?? 2.8;
  const coolantC = frame?.sensors?.coolant_temp_c ?? 42;
  const egt = frame?.sensors?.egt_1 ?? 310;

  const checks = [
    { label: "Dual FADEC Lane A/B Redundancy Check", done: currentT >= 4, detail: "CAN bus telemetry synchronized" },
    { label: "Turbocharger Wastegate & Boost Calibration", done: currentT >= 15, detail: `${mapBar.toFixed(2)} bar MAP nominal` },
    { label: "Rotax 915 iS Oil Circuit Pressure Stabilization", done: currentT >= 35, detail: `${oilPress.toFixed(2)} bar hydraulic pressure` },
    { label: "4-Cylinder Thermal Gradient Baseline", done: currentT >= 55, detail: `EGT: ${Math.round(egt)}°C · Coolant: ${Math.round(coolantC)}°C` },
    { label: "AI Reliability Engine Horizon Convergence", done: currentT >= 75, detail: "Monte Carlo failure projection ready" },
  ];

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #0a1118 0%, #0d1720 100%)",
        border: "1px solid rgba(84, 198, 209, 0.35)",
        borderRadius: "14px",
        padding: "24px",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
        marginBottom: "20px",
        color: "#fff",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#f59e0b",
                boxShadow: "0 0 10px #f59e0b",
                display: "inline-block",
                animation: "pulse-glow 1.5s infinite alternate",
              }}
            />
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "0.03em" }}>
              FADEC BASELINE WARM-UP & SPOOLING ({tail})
            </h2>
          </div>
          <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: 4 }}>
            Gathering 75-second baseline telemetry for physics-informed neural network convergence.
          </div>
        </div>

        {/* Action Buttons for User Freedom */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={onExploreBackground}
            style={{
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              color: "#ffffff",
              border: "1px solid #38bdf8",
              borderRadius: "8px",
              padding: "9px 16px",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 12px rgba(2, 132, 199, 0.4)",
              transition: "all 0.2s ease",
            }}
          >
            <span>Explore in Background</span>
            <span>➔</span>
          </button>

          <button
            onClick={onViewTelemetry}
            style={{
              background: "#1e293b",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              borderRadius: "8px",
              padding: "9px 15px",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.2s ease",
            }}
          >
            <span>Skip to Live Cockpit</span>
            <span>⚡</span>
          </button>
        </div>
      </div>

      {/* Progress Bar & Countdown */}
      <div style={{ marginTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", marginBottom: "6px" }}>
          <span style={{ color: "#38bdf8", fontWeight: 700, letterSpacing: "0.05em" }}>
            INITIALIZATION PROGRESS: {progressPct}%
          </span>
          <span style={{ color: "#f59e0b", fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>
            {secondsLeft > 0 ? `${secondsLeft}s remaining until full AI convergence` : "Baseline converged ✓"}
          </span>
        </div>
        <div style={{ width: "100%", height: "8px", background: "rgba(255, 255, 255, 0.08)", borderRadius: "4px", overflow: "hidden" }}>
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: "linear-gradient(90deg, #0284c7 0%, #38bdf8 60%, #10b981 100%)",
              borderRadius: "4px",
              transition: "width 0.8s ease-out",
            }}
          />
        </div>
      </div>

      {/* Real-time Spooling Telemetry Gauges */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "12px",
          marginTop: "20px",
        }}
      >
        <div style={{ background: "#080e13", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>ENGINE RPM</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#38bdf8", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            {rpm > 0 ? Math.round(rpm) : "—"}
          </div>
          <div style={{ fontSize: "10px", color: "#64748b", marginTop: 2 }}>Idle target: 2000</div>
        </div>

        <div style={{ background: "#080e13", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>MANIFOLD BOOST</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#10b981", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            {mapBar.toFixed(2)} <span style={{ fontSize: "12px", color: "#64748b" }}>bar</span>
          </div>
          <div style={{ fontSize: "10px", color: "#64748b", marginTop: 2 }}>Nominal 0.95-1.55</div>
        </div>

        <div style={{ background: "#080e13", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>OIL PRESSURE</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: oilPress < 2.0 ? "#ef4444" : "#10b981", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            {oilPress.toFixed(2)} <span style={{ fontSize: "12px", color: "#64748b" }}>bar</span>
          </div>
          <div style={{ fontSize: "10px", color: "#64748b", marginTop: 2 }}>Limit: &gt; 1.50 bar</div>
        </div>

        <div style={{ background: "#080e13", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>COOLANT TEMP</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#e2e8f0", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            {Math.round(coolantC)} <span style={{ fontSize: "12px", color: "#64748b" }}>°C</span>
          </div>
          <div style={{ fontSize: "10px", color: "#64748b", marginTop: 2 }}>Normal &lt; 115°C</div>
        </div>

        <div style={{ background: "#080e13", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "12px" }}>
          <div style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em" }}>CYL 1 EXHAUST</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#f59e0b", fontFamily: "var(--font-mono)", marginTop: 4 }}>
            {Math.round(egt)} <span style={{ fontSize: "12px", color: "#64748b" }}>°C</span>
          </div>
          <div style={{ fontSize: "10px", color: "#64748b", marginTop: 2 }}>Limit &lt; 950°C</div>
        </div>
      </div>

      {/* Checklist */}
      <div style={{ marginTop: "22px", background: "rgba(0,0,0,0.25)", borderRadius: "10px", padding: "14px 16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#54c6d1", letterSpacing: "0.08em", marginBottom: "10px" }}>
          FADEC SYSTEM CHECKLIST
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px" }}>
          {checks.map((chk, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "12px" }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: chk.done ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.05)",
                  border: chk.done ? "1px solid #10b981" : "1px solid rgba(255, 255, 255, 0.2)",
                  color: chk.done ? "#10b981" : "#64748b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 800,
                }}
              >
                {chk.done ? "✓" : "○"}
              </span>
              <div>
                <span style={{ color: chk.done ? "#f1f5f9" : "#94a3b8", fontWeight: chk.done ? 600 : 400 }}>
                  {chk.label}
                </span>
                <span style={{ display: "block", fontSize: "11px", color: "#64748b" }}>
                  {chk.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Background hint */}
      <div
        style={{
          marginTop: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: "#94a3b8",
        }}
      >
        <span>
          💡 <em>Tip: You can safely leave this tab or switch aircraft — the simulator keeps streaming in the background.</em>
        </span>
        <Link
          href={`/uav/${engineId}/twin3d`}
          style={{ color: "#38bdf8", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <span>Open Full 3D Twin View</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}
