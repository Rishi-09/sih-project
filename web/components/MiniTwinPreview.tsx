"use client";

import React from "react";
import Link from "next/link";
import { Twin3DCanvas } from "@/components/twin3d/Twin3DCanvas";
import { TickFrame } from "@/lib/types";

interface Props {
  engineId: string;
  frame: TickFrame | null;
}

export function MiniTwinPreview({ engineId, frame }: Props) {
  return (
    <div
      id="mini-twin-container"
      style={{
        background: "#0c1216",
        border: "1px solid rgba(84, 198, 209, 0.25)",
        borderRadius: "12px",
        overflow: "hidden",
        position: "relative",
        height: "440px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        marginBottom: "18px",
      }}
    >
      {/* Dedicated Header Bar - Eliminates any overlap with internal 3D canvas HUD controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 14px",
          background: "linear-gradient(90deg, #090e12 0%, #0d151c 100%)",
          borderBottom: "1px solid rgba(84, 198, 209, 0.2)",
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "11px",
            fontWeight: 700,
            color: "#54c6d1",
            letterSpacing: "0.06em",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#54c6d1", boxShadow: "0 0 8px #54c6d1" }} />
          <span>3D ENGINE DIGITAL TWIN PREVIEW</span>
        </div>

        <Link
          id="btn-open-full-twin"
          href={`/uav/${engineId}/twin3d`}
          style={{
            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
            color: "#ffffff",
            padding: "5px 13px",
            borderRadius: "6px",
            fontSize: "11.5px",
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            transition: "all 0.2s ease",
          }}
        >
          <span>Open Full 3D Twin</span>
          <span>◈</span>
        </Link>
      </div>

      <div style={{ flex: 1, width: "100%", height: "100%", position: "relative" }}>
        <Twin3DCanvas frame={frame} autoRotate={true} />
      </div>
    </div>
  );
}
