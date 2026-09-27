"use client";

import React, { useState } from "react";

const FAULT_OPTIONS = [
  { id: "lubrication_degradation", name: "Lubrication Degradation", category: "Lubrication", desc: "Oil pressure drops, oil temp rises, friction spikes" },
  { id: "cooling_failure", name: "Cooling Circuit Failure", category: "Cooling", desc: "Coolant temp climbs toward redline, risk of head warp" },
  { id: "ignition_fault_cyl3", name: "Cylinder 3 Ignition Misfire", category: "Combustion", desc: "Cyl 3 EGT drops, vibration increases, power lost" },
  { id: "induction_loss", name: "Turbo Induction Loss", category: "Induction", desc: "MAP boost leak, unable to maintain high altitude power" },
  { id: "fuel_system_degradation", name: "Fuel Filter Clog / Degradation", category: "Fuel", desc: "Fuel flow restriction under high throttle demand" },
  { id: "bearing_wear", name: "Main Bearings Wear", category: "Mechanical", desc: "Vibration telemetry surges beyond normal 3σ threshold" },
  { id: "injector_fault_cyl3", name: "Cylinder 3 Injector Clog", category: "Fuel / Injection", desc: "Uneven cylinder combustion, high residual z-score" },
  { id: "electrical_degradation", name: "Electrical / FADEC Voltage Drop", category: "Electrical", desc: "Alternator bus voltage sag under avionics load" },
  { id: "sensor_freeze_coolant", name: "Coolant Sensor Freeze (Lying Sensor)", category: "Sensors", desc: "Virtual sensor catches discrepancy between physics & sensor" },
  { id: "sensor_drift_oilpress", name: "Oil Pressure Sensor Drift", category: "Sensors", desc: "Drifting calibration flags sensor fault vs real engine issue" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  injectedFaults: string[];
  onInject: (type: string, severity: number) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}

export function FaultInjectorDrawer({
  isOpen,
  onClose,
  injectedFaults,
  onInject,
  onClear,
}: Props) {
  const [selectedFault, setSelectedFault] = useState(FAULT_OPTIONS[0].id);
  const [severity, setSeverity] = useState(0.7);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const handleInject = async () => {
    setBusy(true);
    try {
      await onInject(selectedFault, severity);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await onClear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "360px",
        background: "#0f161b",
        borderLeft: "1px solid rgba(84, 198, 209, 0.3)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.6)",
        zIndex: 9000,
        display: "flex",
        flexDirection: "column",
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#131c22",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18, color: "#f59e0b" }}>⚡</span>
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.02em" }}>FAULT INJECTION SUITE</span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            fontSize: 20,
            cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Active Faults Summary */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>
            Currently Injected Faults
          </div>
          {injectedFaults.length === 0 ? (
            <div style={{ fontSize: 12, color: "#34d399", background: "rgba(16,185,129,0.1)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.2)" }}>
              ✓ Engine running nominal — No faults active
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {injectedFaults.map((f) => (
                <div
                  key={f}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#fca5a5",
                  }}
                >
                  <span>⚠️ {f.replace(/_/g, " ")}</span>
                </div>
              ))}
              <button
                onClick={handleClear}
                disabled={busy}
                style={{
                  background: "#1e293b",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#cbd5e1",
                  padding: "6px",
                  borderRadius: 6,
                  fontSize: 11.5,
                  cursor: "pointer",
                  marginTop: 4,
                  fontWeight: 600,
                }}
              >
                Clear All Active Faults
              </button>
            </div>
          )}
        </div>

        {/* Fault Selector */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
            Select Fault Mode
          </label>
          <select
            value={selectedFault}
            onChange={(e) => setSelectedFault(e.target.value)}
            style={{
              width: "100%",
              background: "#18222a",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#f1f5f9",
              padding: "10px",
              borderRadius: 8,
              fontSize: 13,
              outline: "none",
            }}
          >
            {FAULT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name} ({opt.category})
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
            {FAULT_OPTIONS.find((o) => o.id === selectedFault)?.desc}
          </div>
        </div>

        {/* Severity Slider */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
              Severity Level
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: severity >= 0.8 ? "#ef4444" : severity >= 0.5 ? "#f59e0b" : "#10b981" }}>
              {Math.round(severity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.1"
            value={severity}
            onChange={(e) => setSeverity(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: "#f59e0b" }}
          />
        </div>

        {/* CTA Button */}
        <button
          onClick={handleInject}
          disabled={busy}
          style={{
            background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
            color: "#ffffff",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            padding: "12px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(217, 119, 6, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span>⚡ {injectedFaults.includes(selectedFault) ? "Update Severity" : "Inject Fault Now"}</span>
        </button>
      </div>
    </div>
  );
}
