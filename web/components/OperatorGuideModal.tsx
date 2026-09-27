"use client";

import React, { useEffect } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OperatorGuideModal({ isOpen, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "auto";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(3, 7, 10, 0.88)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        padding: "16px",
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#0c1318",
          border: "1px solid rgba(56, 189, 248, 0.35)",
          borderRadius: "16px",
          maxWidth: "580px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "24px 28px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.95), 0 0 30px rgba(56, 189, 248, 0.15)",
          position: "relative",
          animation: "scale-up 0.18s ease-out",
          color: "#e2e8f0",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with DRDO Emblem */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            paddingBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img
              src="/drdo-logo.png"
              alt="DRDO"
              style={{ height: "36px", width: "auto", objectFit: "contain" }}
            />
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", letterSpacing: "0.03em" }}>
                DRDO // OPERATOR WALKTHROUGH
              </div>
              <div style={{ fontSize: "12px", color: "#38bdf8", fontFamily: "var(--font-mono, monospace)" }}>
                RETRIBUTION UAV DIGITAL TWIN GUIDE
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#1e293b",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#cbd5e1",
              fontSize: "18px",
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Intro */}
        <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "18px", lineHeight: "1.5" }}>
          Follow these 3 simple operational steps to stream live telemetry, monitor physics residuals, and simulate faults on the Rotax 915 iS engine twin.
        </div>

        {/* Step 1 */}
        <div
          style={{
            display: "flex",
            gap: "14px",
            background: "#121b22",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "10px",
            padding: "14px",
            marginBottom: "12px",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: "30px",
              height: "30px",
              minWidth: "30px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#041410",
              fontWeight: 800,
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 10px rgba(16, 185, 129, 0.4)",
            }}
          >
            1
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: "14px", marginBottom: "4px" }}>
              Select Aircraft & Open Console
            </div>
            <div style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: "1.5" }}>
              From the <strong>Dashboard</strong> or <strong>Fleet</strong> page, click the blue{" "}
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>Console →</span> button on any aircraft (e.g. UAV-01) to enter its tactical cockpit.
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div
          style={{
            display: "flex",
            gap: "14px",
            background: "#121b22",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "10px",
            padding: "14px",
            marginBottom: "12px",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: "30px",
              height: "30px",
              minWidth: "30px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #38bdf8, #0284c7)",
              color: "#041410",
              fontWeight: 800,
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 10px rgba(56, 189, 248, 0.4)",
            }}
          >
            2
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: "14px", marginBottom: "4px" }}>
              Launch Sortie & Stream Telemetry
            </div>
            <div style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: "1.5" }}>
              Click <strong>&quot;Start sortie&quot;</strong> in the Control Bar. The Python flight dynamics & thermodynamics simulator spins up at 20 Hz, streaming real-time sensor frames into the AI twin.
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div
          style={{
            display: "flex",
            gap: "14px",
            background: "#121b22",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "10px",
            padding: "14px",
            marginBottom: "20px",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: "30px",
              height: "30px",
              minWidth: "30px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              color: "#041410",
              fontWeight: 800,
              fontSize: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 10px rgba(245, 158, 11, 0.4)",
            }}
          >
            3
          </div>
          <div>
            <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: "14px", marginBottom: "4px" }}>
              Inspect 3D Twin & Inject Faults
            </div>
            <div style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: "1.5" }}>
              Click <strong style={{ color: "#34d399" }}>3D Twin ◈</strong> to view the Rotax 915 iS engine. Toggle between <strong>Solid CAD</strong> and <strong>Thermal FLIR</strong> views. Use the <strong style={{ color: "#f59e0b" }}>⚡ Inject Fault</strong> drawer to simulate lubrication loss, cooling degradation, or misfire in real time!
            </div>
          </div>
        </div>

        {/* Bottom Button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#041014",
              border: "none",
              padding: "10px 24px",
              borderRadius: "8px",
              fontWeight: 800,
              fontSize: "13.5px",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(16, 185, 129, 0.4)",
            }}
          >
            Got it, Let&apos;s Fly! 🚀
          </button>
        </div>
      </div>
    </div>
  );
}
