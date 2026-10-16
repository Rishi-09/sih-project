"use client";

import React from "react";
import Link from "next/link";

interface Props {
  isOpen: boolean;
  engineTail: string;
  engineId: string;
  onStartSortie: () => void;
  onDismiss: () => void;
}

export function SortieModalPopup({
  isOpen,
  engineTail,
  engineId,
  onStartSortie,
  onDismiss,
}: Props) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(6, 10, 14, 0.8)",
        backdropFilter: "blur(8px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          background: "#10171d",
          border: "1px solid rgba(84, 198, 209, 0.3)",
          borderRadius: "14px",
          maxWidth: "480px",
          width: "100%",
          padding: "28px",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.7)",
          color: "var(--ink)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "var(--caution-soft)",
            border: "1px solid rgba(224, 168, 46, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            margin: "0 auto 16px",
            color: "var(--caution)",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.6v5M12 16.2h.01" />
          </svg>
        </div>

        <div style={{ fontSize: "19px", fontWeight: 800, color: "var(--ink)", marginBottom: "8px" }}>
          No active sortie
        </div>

        <div style={{ fontSize: "13px", color: "var(--ink-2)", lineHeight: 1.5, marginBottom: "24px" }}>
          <strong>{engineTail}</strong> does not have an active sortie running. Live 1 Hz sensor telemetry, AI fault diagnosis, and thermal heatmaps require a live flight stream.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            type="button"
            onClick={onStartSortie}
            style={{
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              padding: "12px 18px",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "13.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
                          }}
          >
            <span>Start nominal sortie (S1)</span>
          </button>

          <button
            type="button"
            onClick={onDismiss}
            style={{
              background: "#1b252d",
              color: "var(--accent)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              padding: "11px 18px",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <span>Inspect the engine twin only</span>
          </button>

          <Link
            href={`/uav/${engineId}`}
            style={{
              background: "transparent",
              color: "var(--ink-3)",
              padding: "8px 12px",
              borderRadius: "6px",
              fontWeight: 500,
              fontSize: "12.5px",
              textDecoration: "none",
              display: "inline-block",
              marginTop: "4px",
            }}
          >
            ← Back to Aircraft 2D Console
          </Link>
        </div>
      </div>
    </div>
  );
}
