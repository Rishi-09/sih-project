"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function TutorialScenarioModal({ isOpen, onClose }: Props) {
  const [step, setStep] = useState(1);
  const [tach, setTach] = useState(0);
  const [oilPress, setOilPress] = useState(4.8);
  const [thermalMode, setThermalMode] = useState(false);
  const [faultInjected, setFaultInjected] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<number | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setTach(0);
      setOilPress(4.8);
      setThermalMode(false);
      setFaultInjected(false);
      setSelectedDecision(null);
      setDecisionFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(2, 6, 9, 0.9)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999999,
        padding: "16px",
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#0c1218",
          border: "1px solid rgba(56, 189, 248, 0.35)",
          borderRadius: "16px",
          maxWidth: "680px",
          width: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "26px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.95), 0 0 32px rgba(56, 189, 248, 0.15)",
          position: "relative",
          animation: "scale-up 0.18s ease-out",
          color: "#e2e8f0",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px", marginBottom: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/drdo-logo.png" alt="DRDO" style={{ height: "34px", width: "auto", objectFit: "contain" }} />
            <div>
              <div style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc", letterSpacing: "0.03em" }}>
                DRDO // INTERACTIVE MISSION TUTORIAL
              </div>
              <div style={{ fontSize: "11px", color: "#38bdf8", fontFamily: "var(--font-mono, monospace)" }}>
                STEP-BY-STEP HANDS-ON SCENARIO • STEP {step} OF 6
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#cbd5e1",
              fontSize: "16px",
              width: "30px",
              height: "30px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Step Progress Pills */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px", marginBottom: "20px" }}>
          {[
            "1. Orientation",
            "2. Start Sortie",
            "3. 3D Twin",
            "4. Inject Fault",
            "5. AI Decision",
            "6. Recovery",
          ].map((title, idx) => (
            <div
              key={idx}
              style={{
                height: "4px",
                borderRadius: "2px",
                background: idx + 1 <= step ? "#38bdf8" : "rgba(255, 255, 255, 0.1)",
                transition: "background 0.3s ease",
              }}
              title={title}
            />
          ))}
        </div>

        {/* STEP 1: Orientation */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
              Step 1: Cockpit Instruments &amp; Telemetry Matrix
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              Welcome to the <strong>Retribution Digital Twin Platform</strong> for the Rotax 915 iS turbocharged UAV powerplant.
            </p>
            <div style={{ background: "#111921", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px", margin: "14px 0" }}>
              <div style={{ fontSize: "12.5px", marginBottom: "8px", color: "#f8fafc", fontWeight: 600 }}>
                Key Operational Controls Explained:
              </div>
              <ul style={{ fontSize: "12px", color: "#94a3b8", lineHeight: "1.7", paddingLeft: "20px", margin: 0 }}>
                <li><strong>EHI (Engine Health Index):</strong> 0–100 scale measuring real-time degradation across 8 physical subsystems.</li>
                <li><strong>P(Completion):</strong> Monte Carlo probability that the aircraft will successfully finish its mission without breach.</li>
                <li><strong>10-Channel Residual Matrix:</strong> Measures deviations between real sensors and the physics-predicted twin.</li>
              </ul>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                style={{ background: "#0284c7", color: "#fff", border: "none", padding: "9px 20px", borderRadius: "8px", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}
              >
                Acknowledge &amp; Proceed to Launch →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Start Sortie */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
              Step 2: Launching a Sortie &amp; 75s Warm-up Window
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              To stream real-time physics and ML inference, you launch a sortie using the <strong>Start sortie</strong> button. During the first 75 seconds, the twin observes steady-state thermal baselines.
            </p>

            <div style={{ background: "#111921", border: "1px solid rgba(56,189,248,0.2)", borderRadius: "10px", padding: "18px", margin: "14px 0", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "8px" }}>INTERACTIVE BUTTON SIMULATOR:</div>
              <button
                type="button"
                onClick={() => {
                  setTach(5200);
                  setTimeout(() => setStep(3), 900);
                }}
                style={{
                  background: tach > 0 ? "#10b981" : "#0284c7",
                  color: "#fff",
                  border: "none",
                  padding: "12px 28px",
                  borderRadius: "8px",
                  fontWeight: 800,
                  fontSize: "14px",
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(2, 132, 199, 0.4)",
                  transition: "all 0.2s ease",
                }}
              >
                {tach > 0 ? "✓ Engine Spooled to 5200 RPM!" : "▶ Click: Start Sortie"}
              </button>
              {tach > 0 && (
                <div style={{ marginTop: "12px", color: "#34d399", fontSize: "12px", fontWeight: 600 }}>
                  ⚡ Telemetry Stream Active: Dual FADEC synced, 75s baseline calibrating in background.
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: 3D Twin & Views */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
              Step 3: 3D Digital Twin Inspection &amp; Thermal FLIR
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              Clicking <strong>3D Twin ◈</strong> loads the photorealistic 3D Rotax 915 iS engine. You can toggle between <strong>Solid CAD</strong> (PBR metals) and <strong>FLIR Thermal</strong> (real-time infrared heatmap).
            </p>

            <div style={{ background: "#111921", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px", margin: "14px 0", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "12px" }}>TEST THE VIEW SWITCHER:</div>
              <div style={{ display: "inline-flex", gap: "10px", background: "#080c10", padding: "6px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <button
                  type="button"
                  onClick={() => setThermalMode(false)}
                  style={{
                    background: !thermalMode ? "rgba(56,189,248,0.2)" : "transparent",
                    color: !thermalMode ? "#38bdf8" : "#94a3b8",
                    border: "none",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    fontWeight: 700,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  SOLID CAD
                </button>
                <button
                  type="button"
                  onClick={() => setThermalMode(true)}
                  style={{
                    background: thermalMode ? "#ef4444" : "transparent",
                    color: thermalMode ? "#fff" : "#94a3b8",
                    border: "none",
                    padding: "6px 14px",
                    borderRadius: "6px",
                    fontWeight: 700,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  THERMAL FLIR 🔥
                </button>
              </div>

              {thermalMode && (
                <div style={{ marginTop: "14px", color: "#f87171", fontSize: "12px", fontWeight: 600 }}>
                  ✓ FLIR Thermal view enabled! Cylinder heads mapped to 112°C, exhaust headers to 820°C.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => setStep(4)}
                style={{ background: "#0284c7", color: "#fff", border: "none", padding: "9px 20px", borderRadius: "8px", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}
              >
                Proceed to Fault Injection →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Inject Fault */}
        {step === 4 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#f59e0b", marginBottom: "8px" }}>
              Step 4: Simulating Engine Failure (Fault Injection)
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              In real UAV missions, in-flight failures must be caught before catastrophic loss. The <strong>⚡ Inject Fault</strong> drawer lets you simulate 10 physical anomalies (oil loss, cooling failure, injector misfire).
            </p>

            <div style={{ background: "#111921", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "10px", padding: "18px", margin: "14px 0", textAlign: "center" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "10px" }}>TRY INJECTING A FAULT NOW:</div>
              <button
                type="button"
                onClick={() => {
                  setFaultInjected(true);
                  setOilPress(1.8);
                  setTimeout(() => setStep(5), 900);
                }}
                style={{
                  background: faultInjected ? "#ef4444" : "linear-gradient(135deg, #d97706, #b45309)",
                  color: "#fff",
                  border: "none",
                  padding: "11px 24px",
                  borderRadius: "8px",
                  fontWeight: 800,
                  fontSize: "13.5px",
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(217, 119, 6, 0.4)",
                }}
              >
                {faultInjected ? "⚠ Lubrication Degradation Injected!" : "⚡ Inject: Lubrication Degradation (50%)"}
              </button>

              {faultInjected && (
                <div style={{ marginTop: "12px", color: "#f87171", fontSize: "12px", fontWeight: 600 }}>
                  Oil pressure dropped from 4.8 bar → 1.8 bar! AI Anomaly Detector triggered.
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: Tactical AI Decision */}
        {step === 5 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#ef4444", marginBottom: "8px" }}>
              Step 5: Tactical Decision Making (AI Advisory)
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              Oil pressure is holding at <strong>1.8 bar</strong> (caution threshold). The AI digital twin evaluates your flight envelope. What is your operational decision?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", margin: "16px 0" }}>
              {[
                { id: 1, label: "A) Maintain 100% full throttle & continue route", desc: "Engine will suffer thermal runaway in ~8 minutes." },
                { id: 2, label: "B) Pull throttle back to 65% power (Derate power)", desc: "Reduces thermal shear, preserving oil film and restoring endurance by 45 min." },
                { id: 3, label: "C) Immediately cut engine and crash land", desc: "Excessive response for a recoverable drone with adequate margin." },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSelectedDecision(opt.id);
                    if (opt.id === 2) {
                      setDecisionFeedback("CORRECT! Derating power to 65% lowers friction heat, preserving safe engine endurance and preventing seizure!");
                    } else if (opt.id === 1) {
                      setDecisionFeedback("INCORRECT! Full throttle at 1.8 bar oil pressure will destroy engine bearings within 8 minutes.");
                    } else {
                      setDecisionFeedback("INCORRECT! Cutting the engine is unnecessary. The twin calculates 65% power allows safe RTB.");
                    }
                  }}
                  style={{
                    background: selectedDecision === opt.id ? (opt.id === 2 ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)") : "#111921",
                    border: `1px solid ${selectedDecision === opt.id ? (opt.id === 2 ? "#10b981" : "#ef4444") : "rgba(255,255,255,0.08)"}`,
                    borderRadius: "8px",
                    padding: "12px 14px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "13px", color: selectedDecision === opt.id ? (opt.id === 2 ? "#34d399" : "#f87171") : "#f1f5f9" }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "3px" }}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>

            {decisionFeedback && (
              <div style={{ background: selectedDecision === 2 ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)", border: `1px solid ${selectedDecision === 2 ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)"}`, padding: "12px", borderRadius: "8px", fontSize: "12.5px", color: selectedDecision === 2 ? "#34d399" : "#f87171", fontWeight: 600 }}>
                {decisionFeedback}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                type="button"
                disabled={selectedDecision !== 2}
                onClick={() => setStep(6)}
                style={{
                  background: selectedDecision === 2 ? "#10b981" : "#334155",
                  color: selectedDecision === 2 ? "#061016" : "#64748b",
                  border: "none",
                  padding: "9px 20px",
                  borderRadius: "8px",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: selectedDecision === 2 ? "pointer" : "not-allowed",
                }}
              >
                Proceed to Mission Recovery →
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Recovery & Certified */}
        {step === 6 && (
          <div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#10b981", marginBottom: "8px" }}>
              Step 6: Clearing Faults &amp; Mission Complete!
            </div>
            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.6" }}>
              After clearing faults with <strong>Clear all</strong>, the engine stabilizes back to nominal parameters. The <strong>2m Auto-kill</strong> timer automatically shuts down idle simulators to conserve server credits.
            </p>

            <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "10px", padding: "20px", margin: "16px 0", textAlign: "center" }}>
              <div style={{ fontSize: "36px", marginBottom: "8px" }}>🎖️</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#34d399" }}>
                TUTORIAL CERTIFICATION COMPLETE
              </div>
              <div style={{ fontSize: "12.5px", color: "#cbd5e1", marginTop: "6px", maxWidth: "480px", margin: "6px auto 0" }}>
                You have successfully mastered: starting sorties, 3D inspection, injecting physical anomalies, and executing tactical power-derate decisions.
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "24px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "#10b981",
                  color: "#061016",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: "8px",
                  fontWeight: 800,
                  fontSize: "13.5px",
                  cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(16, 185, 129, 0.4)",
                }}
              >
                Enter Tactical Cockpit 🚀
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
