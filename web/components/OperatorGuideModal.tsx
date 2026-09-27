"use client";

import React from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OperatorGuideModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-guide-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
              <span>✈️</span> UAV Engine Digital Twin — Quick Operator Guide
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
              How to navigate, launch sorties, and inspect AI diagnostics in 3 simple steps
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#cbd5e1",
              fontSize: 16,
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div className="guide-step-card">
          <div className="guide-step-num">1</div>
          <div>
            <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 14 }}>
              Choose Aircraft & Open Console
            </div>
            <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
              From the <strong>Dashboard</strong> or <strong>Fleet</strong> page, click the blue{" "}
              <span style={{ color: "#38bdf8", fontWeight: 600 }}>Console →</span> button on any aircraft (e.g. UAV-01).
            </div>
          </div>
        </div>

        <div className="guide-step-card">
          <div className="guide-step-num">2</div>
          <div>
            <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 14 }}>
              Launch Sortie & Stream Telemetry
            </div>
            <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
              Click <strong>&quot;Start sortie&quot;</strong> in the Control Bar. The Python flight simulator spins up and streams real-time 1 Hz sensor data (throttle, altitude, RPM, temperatures, pressures) into the digital twin.
            </div>
          </div>
        </div>

        <div className="guide-step-card">
          <div className="guide-step-num">3</div>
          <div>
            <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 14 }}>
              View 3D Twin & Simulate Engine Faults
            </div>
            <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
              Click <strong style={{ color: "#34d399" }}>3D Twin ◈</strong> to see the Rotax 915 iS engine in 3D. Switch between <strong>Solid CAD</strong>, <strong>Thermal FLIR</strong>, and <strong>Hologram</strong> views. Use the <strong style={{ color: "#f59e0b" }}>⚡ Inject Fault</strong> button to test cooling loss, lubrication degradation, or misfire!
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "#10b981",
              color: "#061016",
              border: "none",
              padding: "10px 20px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Got it, Let&apos;s Fly! 🚀
          </button>
        </div>
      </div>
    </div>
  );
}
