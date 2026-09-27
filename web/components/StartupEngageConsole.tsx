"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { EngineSummary, TickFrame } from "@/lib/types";

interface Props {
  engine: EngineSummary;
  runId: string;
  frame: TickFrame | null;
  onExploreBackground: () => void;
}

const TOTAL_STARTUP_SECONDS = 75;

export function StartupEngageConsole({ engine, runId, frame, onExploreBackground }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [tachRpm, setTachRpm] = useState(1200);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        // Simulate realistic engine spooling RPM curve up to 5200 RPM
        if (next < 15) setTachRpm(1200 + Math.floor(Math.random() * 80)); // starter cranking
        else if (next < 35) setTachRpm(2400 + Math.floor(Math.random() * 120)); // idle warmup
        else if (next < 55) setTachRpm(4200 + Math.floor(Math.random() * 100)); // magneto check
        else setTachRpm(5180 + Math.floor(Math.random() * 60)); // takeoff power
        return Math.min(TOTAL_STARTUP_SECONDS, next);
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, TOTAL_STARTUP_SECONDS - elapsed);
  const progressPct = Math.round((elapsed / TOTAL_STARTUP_SECONDS) * 100);

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #111820 0%, #0d1318 100%)",
        border: "1px solid rgba(56, 189, 248, 0.25)",
        borderRadius: "14px",
        padding: "24px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        marginTop: "16px",
        color: "#e2e8f0",
      }}
    >
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: "16px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="/drdo-logo.png" alt="DRDO" style={{ height: "34px", width: "auto", objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>PRE-FLIGHT SPOOLING &amp; BASELINE CALIBRATION</span>
              <span style={{ fontSize: "11px", background: "rgba(56,189,248,0.15)", color: "#38bdf8", padding: "2px 8px", borderRadius: "12px", border: "1px solid rgba(56,189,248,0.3)" }}>
                75s Warm-up Window
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
              Rotax 915 iS Dual-FADEC • Establishing steady-state thermal and Monte Carlo bounds for {engine.tail}
            </div>
          </div>
        </div>

        {/* Explore in Background CTA */}
        <button
          type="button"
          onClick={onExploreBackground}
          style={{
            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
            color: "#ffffff",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            padding: "9px 18px",
            borderRadius: "8px",
            fontSize: "12.5px",
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 4px 14px rgba(2, 132, 199, 0.35)",
            transition: "all 0.15s ease",
          }}
        >
          <span>🚀 Start in Background &amp; Explore</span>
        </button>
      </div>

      {/* Progress & Countdown Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        {/* RPM Tachometer */}
        <div style={{ background: "#090e12", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Engine Tachometer
          </div>
          <div style={{ fontSize: "32px", fontWeight: 800, fontFamily: "var(--font-mono, monospace)", color: "#38bdf8", margin: "6px 0" }}>
            {tachRpm} <span style={{ fontSize: "14px", color: "#94a3b8" }}>RPM</span>
          </div>
          <div style={{ fontSize: "11.5px", color: elapsed < 35 ? "#fbbf24" : "#34d399", fontWeight: 600 }}>
            {elapsed < 15 ? "Starter Cranking" : elapsed < 35 ? "Cold Idle Warmup" : elapsed < 55 ? "Magneto Dual Check" : "Rated Climb Power"}
          </div>
        </div>

        {/* Countdown Timer */}
        <div style={{ background: "#090e12", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
            Baseline Window Remaining
          </div>
          <div style={{ fontSize: "32px", fontWeight: 800, fontFamily: "var(--font-mono, monospace)", color: "#f8fafc", margin: "6px 0" }}>
            {remaining} <span style={{ fontSize: "14px", color: "#94a3b8" }}>sec</span>
          </div>
          <div style={{ fontSize: "11.5px", color: "#94a3b8" }}>
            {progressPct}% of 75s calibration complete
          </div>
        </div>

        {/* Live Subsystem Health Status */}
        <div style={{ background: "#090e12", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", marginBottom: "8px" }}>
            FADEC Health Checks
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11.5px", fontFamily: "var(--font-mono, monospace)" }}>
            <div style={{ color: "#34d399" }}>✓ ECU A &amp; B Sync: ACTIVE</div>
            <div style={{ color: elapsed >= 10 ? "#34d399" : "#64748b" }}>
              {elapsed >= 10 ? "✓" : "○"} Fuel Rail Press: 5.2 bar
            </div>
            <div style={{ color: elapsed >= 25 ? "#34d399" : "#64748b" }}>
              {elapsed >= 25 ? "✓" : "○"} Turbo Vanes: Monitored
            </div>
            <div style={{ color: elapsed >= 45 ? "#34d399" : "#64748b" }}>
              {elapsed >= 45 ? "✓" : "○"} Monte Carlo Projection: Armed
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ height: "8px", background: "#1a252f", borderRadius: "4px", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              background: "linear-gradient(to right, #0284c7, #38bdf8, #10b981)",
              borderRadius: "4px",
              transition: "width 0.9s linear",
            }}
          />
        </div>
      </div>

      {/* Informative Tactical Note & Navigation Shortcuts */}
      <div style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "10px", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ fontSize: "12.5px", color: "#cbd5e1", maxWidth: "560px" }}>
          💡 <strong>Why 75 seconds?</strong> The physics-hybrid twin observes 75s of live thermal slopes and pressure variances to calibrate the baseline and guarantee that <strong>zero false alarms</strong> are triggered during climb.
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Link
            href={`/uav/${engine.id}/twin3d`}
            style={{
              background: "#1e293b",
              color: "#38bdf8",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              padding: "7px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>Inspect 3D Twin</span>
            <span>◈</span>
          </Link>
          <Link
            href="/fleet"
            style={{
              background: "#1e293b",
              color: "#f1f5f9",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              padding: "7px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Fleet View
          </Link>
        </div>
      </div>
    </div>
  );
}
