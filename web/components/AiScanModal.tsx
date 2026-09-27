"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AiScanModal({ isOpen, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setStep(0);
      setProgress(0);
      return;
    }

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setStep(4);
          return 100;
        }
        const next = prev + 5;
        if (next >= 75) setStep(3);
        else if (next >= 50) setStep(2);
        else if (next >= 25) setStep(1);
        return next;
      });
    }, 45);

    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(3, 7, 10, 0.82)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#0e151b",
          border: "1px solid rgba(56, 189, 248, 0.3)",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.8), 0 0 24px rgba(56, 189, 248, 0.15)",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "520px",
          padding: "24px",
          position: "relative",
          animation: "scale-up 0.18s ease-out",
          color: "#e2e8f0",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header with DRDO Emblem */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/drdo-logo.png" alt="DRDO" style={{ height: "34px", width: "auto", objectFit: "contain" }} />
            <div>
              <div style={{ fontSize: "14px", fontWeight: 800, letterSpacing: "0.05em", color: "#f8fafc" }}>
                DRDO // AI TELEMETRY SCAN
              </div>
              <div style={{ fontSize: "11px", color: "#38bdf8", fontFamily: "var(--font-mono, monospace)" }}>
                ROTAX 915 iS • REAL-TIME PHYSICS INFERENCE
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#94a3b8",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Progress Bar & Status */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px", fontFamily: "var(--font-mono, monospace)" }}>
            <span style={{ color: progress === 100 ? "#34d399" : "#38bdf8" }}>
              {progress === 100 ? "SCAN COMPLETE" : "SCANNING ENGINE SENSORS..."}
            </span>
            <span style={{ fontWeight: 700, color: "#f8fafc" }}>{progress}%</span>
          </div>
          <div style={{ height: "6px", background: "#1a252f", borderRadius: "3px", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: progress === 100 ? "linear-gradient(to right, #10b981, #34d399)" : "linear-gradient(to right, #0284c7, #38bdf8)",
                borderRadius: "3px",
                transition: "width 0.05s linear",
              }}
            />
          </div>
        </div>

        {/* Scan Log Steps */}
        <div
          style={{
            background: "#080c10",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "8px",
            padding: "12px 14px",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "11.5px",
            lineHeight: "1.7",
            marginBottom: "20px",
          }}
        >
          <div style={{ color: step >= 0 ? "#38bdf8" : "#475569" }}>
            {step >= 0 ? "✓" : "○"} [1] Querying 10 Sensor Channels (EGT, CHT, MAP, RPM, Oil)
          </div>
          <div style={{ color: step >= 1 ? "#38bdf8" : "#475569" }}>
            {step >= 1 ? "✓" : "○"} [2] Comparing Telemetry against Rotax Physics Twin Baseline
          </div>
          <div style={{ color: step >= 2 ? "#38bdf8" : "#475569" }}>
            {step >= 2 ? "✓" : "○"} [3] Running ML Isolation Forest & 3σ Anomaly Detector
          </div>
          <div style={{ color: step >= 3 ? "#34d399" : "#475569" }}>
            {step >= 3 ? "✓" : "○"} [4] Evaluating Subsystem Margins & Mission Projection
          </div>
        </div>

        {/* Diagnostic Results Card */}
        {progress === 100 ? (
          <div
            style={{
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "20px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34d399", fontWeight: 700, fontSize: "13px", marginBottom: "4px" }}>
              <span>✓</span>
              <span>All 8 Engine Subsystems Verified Nominal</span>
            </div>
            <div style={{ fontSize: "11.5px", color: "#94a3b8" }}>
              Residual Z-scores within normal distribution (Z &lt; 1.2σ). No sensor drift or ignition anomalies detected.
            </div>
          </div>
        ) : (
          <div
            style={{
              background: "rgba(56, 189, 248, 0.08)",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div style={{ width: "16px", height: "16px", border: "2px solid #38bdf8", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <span style={{ fontSize: "12px", color: "#cbd5e1" }}>Evaluating flight envelopes and thermodynamic model...</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: "6px",
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#f1f5f9",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <Link
            href="/fleet"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: "6px",
              background: "#0284c7",
              border: "none",
              color: "#ffffff",
              fontSize: "12.5px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>View Fleet Console</span>
            <span>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
