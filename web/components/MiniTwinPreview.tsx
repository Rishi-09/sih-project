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
        height: "460px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        marginBottom: "18px",
      }}
    >
      {/* Dedicated Preview Header Bar - Completely separate from 3D HUD controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px",
          background: "linear-gradient(90deg, #0d151c 0%, #090e12 100%)",
          borderBottom: "1px solid rgba(84, 198, 209, 0.2)",
          flexShrink: 0,
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#54c6d1",
            letterSpacing: "0.06em",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#54c6d1",
              boxShadow: "0 0 8px #54c6d1",
            }}
          />
          <span>3D DIGITAL TWIN PREVIEW</span>
        </div>

        <Link
          href={`/uav/${engineId}/twin3d`}
          style={{
            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
            color: "#ffffff",
            padding: "5px 14px",
            borderRadius: "6px",
            fontSize: "11.5px",
            fontWeight: 700,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            transition: "all 0.15s ease",
          }}
        >
          <span>Open Full 3D Twin</span>
          <span>◈</span>
        </Link>
      </div>

      {/* 3D Viewport - HUD controls (Solid, Wireframe, Thermal) render inside here cleanly */}
      <div style={{ flex: 1, width: "100%", height: "100%", position: "relative" }}>
        <Twin3DCanvas frame={frame} autoRotate={true} />
      </div>
    </div>
  );
}
