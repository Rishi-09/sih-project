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
      style={{
        background: "#0c1216",
        border: "1px solid rgba(84, 198, 209, 0.25)",
        borderRadius: "12px",
        overflow: "hidden",
        position: "relative",
        height: "220px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        marginBottom: "18px",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(12, 18, 22, 0.8)",
          backdropFilter: "blur(4px)",
          padding: "4px 8px",
          borderRadius: "6px",
          border: "1px solid rgba(255,255,255,0.08)",
          fontSize: "11px",
          fontWeight: 700,
          color: "#54c6d1",
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#54c6d1", boxShadow: "0 0 6px #54c6d1" }} />
        <span>3D ENGINE DIGITAL TWIN PREVIEW</span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          zIndex: 10,
        }}
      >
        <Link
          href={`/uav/${engineId}/twin3d`}
          style={{
            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
            color: "#ffffff",
            padding: "5px 12px",
            borderRadius: "6px",
            fontSize: "11.5px",
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
          }}
        >
          <span>Open Full 3D Twin</span>
          <span>◈</span>
        </Link>
      </div>

      <div style={{ flex: 1, width: "100%", height: "100%" }}>
        <Twin3DCanvas frame={frame} autoRotate={true} />
      </div>
    </div>
  );
}
