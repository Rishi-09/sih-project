"use client";

import React from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStartTutorial?: () => void;
}

export function OperatorGuideModal({ isOpen, onClose, onStartTutorial }: Props) {
  if (!isOpen) return null;

  const handleStartTour = () => {
    onClose();
    if (onStartTutorial) {
      setTimeout(onStartTutorial, 150);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(2, 6, 10, 0.88)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        className="modal-guide-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0c1318",
          border: "1px solid rgba(84, 198, 209, 0.4)",
          borderRadius: "14px",
          width: "100%",
          maxWidth: "680px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "26px",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.9), 0 0 25px rgba(84, 198, 209, 0.15)",
          color: "#f8fafc",
          position: "relative",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#ffffff", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "22px" }}>🛡️</span>
              <span>RETRIBUTION DIGITAL TWIN — OPERATOR GUIDE</span>
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
              DRDO Tactical Command · Rotax 915 iS Engine Operations & Diagnostics
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#cbd5e1",
              fontSize: 16,
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Guided In-Situ Interactive Tour Callout Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(2, 132, 199, 0.2) 0%, rgba(14, 165, 233, 0.1) 100%)",
            border: "1px solid #38bdf8",
            borderRadius: "10px",
            padding: "16px 18px",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, color: "#38bdf8", fontSize: "14px", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🎯</span>
              <span>WANT AN INTERACTIVE WALKTHROUGH?</span>
            </div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: 4, lineHeight: 1.4 }}>
              The interactive tutorial highlights each real button and control right on your dashboard!
            </div>
          </div>

          <button
            onClick={handleStartTour}
            style={{
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              color: "#ffffff",
              border: "1px solid #38bdf8",
              padding: "9px 18px",
              borderRadius: "8px",
              fontWeight: 800,
              fontSize: "12.5px",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(2, 132, 199, 0.5)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>Start Interactive Tour</span>
            <span>🚀</span>
          </button>
        </div>

        {/* Guide Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            className="guide-step-card"
            style={{
              background: "#080e13",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "14px 16px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}
          >
            <div
              className="guide-step-num"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#0284c7",
                color: "#fff",
                fontWeight: 800,
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              1
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 13.5 }}>
                Select UAV & Launch Sortie
              </div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                Click <strong style={{ color: "#38bdf8" }}>Start sortie</strong> on any engine console. The Python simulator ignites the Rotax 915 iS engine and begins streaming 1 Hz real-time sensor telemetry.
              </div>
            </div>
          </div>

          <div
            className="guide-step-card"
            style={{
              background: "#080e13",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "14px 16px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}
          >
            <div
              className="guide-step-num"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#10b981",
                color: "#fff",
                fontWeight: 800,
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              2
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 13.5 }}>
                Inspect 3D Twin & Shaders
              </div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                Toggle between <strong style={{ color: "#54c6d1" }}>Solid CAD</strong>, <strong style={{ color: "#54c6d1" }}>Wireframe</strong>, and <strong style={{ color: "#f59e0b" }}>FLIR Thermal</strong> views to observe temperature gradients across cylinder heads and exhaust manifolds.
              </div>
            </div>
          </div>

          <div
            className="guide-step-card"
            style={{
              background: "#080e13",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              padding: "14px 16px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}
          >
            <div
              className="guide-step-num"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#f59e0b",
                color: "#080e13",
                fontWeight: 800,
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              3
            </div>
            <div>
              <div style={{ fontWeight: 700, color: "#f1f5f9", fontSize: 13.5 }}>
                Inject Faults & Test Neural Limiters
              </div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
                Use the <strong style={{ color: "#ef4444" }}>⚡ Inject Fault</strong> selector to test emergency scenarios like coolant leaks, oil degradation, or misfires. Watch the digital twin adapt with endurance limits and power derate recommendations!
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              background: "#1e293b",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
              padding: "9px 18px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
}
