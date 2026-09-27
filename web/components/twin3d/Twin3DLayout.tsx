"use client";

import { ReactNode, useState, useEffect, useRef } from "react";

interface Props {
  leftPanel: ReactNode;
  centerCanvas: ReactNode;
  rightPanel: ReactNode;
  bottomLog: ReactNode;
}

// The hologram viewport is the reason this page exists; the telemetry and ML
// panels either side are supporting evidence.
export function Twin3DLayout({ leftPanel, centerCanvas, rightPanel, bottomLog }: Props) {
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(310);
  const [bottomHeight, setBottomHeight] = useState(110); // Compact by default to maximize 3D canvas height

  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"telemetry" | "predictor" | "log">("telemetry");

  const isDraggingRef = useRef<"left" | "right" | "bottom" | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      if (isDraggingRef.current === "left") {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setLeftWidth(newWidth);
      } else if (isDraggingRef.current === "right") {
        const newWidth = Math.max(220, Math.min(550, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
      } else if (isDraggingRef.current === "bottom") {
        const newHeight = Math.max(60, Math.min(350, window.innerHeight - e.clientY));
        setBottomHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = null;
        document.body.style.cursor = "default";
        document.body.style.userSelect = "auto";
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isMobile]);

  const startDragging = (type: "left" | "right" | "bottom") => {
    isDraggingRef.current = type;
    document.body.style.cursor = type === "bottom" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  };

  // DEDICATED MOBILE LAYOUT (Not just resized! Stacked view with tab bar below 3D viewport)
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#080d10", overflowX: "hidden" }}>
        {/* Full-width 3D Canvas Viewport (Tall & Immersive) */}
        <div style={{ height: "55vh", minHeight: "360px", width: "100%", position: "relative", background: "#060a0d", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {centerCanvas}
        </div>

        {/* Dedicated Mobile Panel Tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            background: "#0e1317",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <button
            type="button"
            onClick={() => setMobileTab("telemetry")}
            style={{
              padding: "12px 6px",
              background: mobileTab === "telemetry" ? "rgba(56, 189, 248, 0.12)" : "transparent",
              color: mobileTab === "telemetry" ? "#38bdf8" : "#94a3b8",
              border: "none",
              borderBottom: mobileTab === "telemetry" ? "2px solid #38bdf8" : "2px solid transparent",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📋 Telemetry
          </button>

          <button
            type="button"
            onClick={() => setMobileTab("predictor")}
            style={{
              padding: "12px 6px",
              background: mobileTab === "predictor" ? "rgba(52, 211, 153, 0.12)" : "transparent",
              color: mobileTab === "predictor" ? "#34d399" : "#94a3b8",
              border: "none",
              borderBottom: mobileTab === "predictor" ? "2px solid #34d399" : "2px solid transparent",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🧠 AI Predictor
          </button>

          <button
            type="button"
            onClick={() => setMobileTab("log")}
            style={{
              padding: "12px 6px",
              background: mobileTab === "log" ? "rgba(245, 158, 11, 0.12)" : "transparent",
              color: mobileTab === "log" ? "#fbbf24" : "#94a3b8",
              border: "none",
              borderBottom: mobileTab === "log" ? "2px solid #fbbf24" : "2px solid transparent",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            💻 Logs
          </button>
        </div>

        {/* Selected Mobile Content Panel */}
        <div style={{ flex: 1, padding: "16px", background: "#0e1317", minHeight: "300px", paddingBottom: "70px" }}>
          {mobileTab === "telemetry" && leftPanel}
          {mobileTab === "predictor" && rightPanel}
          {mobileTab === "log" && bottomLog}
        </div>
      </div>
    );
  }

  // DESKTOP LAYOUT (3-Column Resizable Layout with Maximum Vertical Height)
  return (
    <div className="twin3d-ide-container" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Upper 3 Columns */}
      <div
        className="ide-workspace"
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          background: "#080d10",
          position: "relative",
        }}
      >
        {/* Left Simulator Telemetry Panel */}
        <aside
          className="ide-panel ide-panel-left"
          style={{ width: `${leftWidth}px`, flexShrink: 0, overflow: "hidden" }}
        >
          <div className="panel-tab-header">
            <span className="tab-active">RADAR SENSOR BUS // MIL-STD-1553</span>
          </div>
          <div className="panel-content">{leftPanel}</div>
        </aside>

        {/* Resizable Divider 1 (Left <-> Center) */}
        <div
          onMouseDown={() => startDragging("left")}
          onDoubleClick={() => setLeftWidth(280)}
          title="Drag to resize panel (Double-click to reset)"
          style={{
            width: "6px",
            background: "rgba(255, 255, 255, 0.04)",
            cursor: "col-resize",
            zIndex: 30,
            transition: "background 0.15s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="resize-handle-col"
        />

        {/* Center 3D Hologram Viewport (Increased Vertical Height) */}
        <main
          className="ide-panel ide-panel-center"
          style={{ flex: 1, minWidth: "300px", overflow: "hidden", position: "relative", height: "100%" }}
        >
          <div className="panel-tab-header">
            <span className="tab-active">3D DIGITAL TWIN</span>
            <span className="tab-sub">ROTAX 915 iS AERO ENGINE</span>
          </div>
          <div className="canvas-wrapper-container" style={{ width: "100%", height: "calc(100% - 32px)", position: "relative" }}>
            {centerCanvas}
          </div>
        </main>

        {/* Resizable Divider 2 (Center <-> Right) */}
        <div
          onMouseDown={() => startDragging("right")}
          onDoubleClick={() => setRightWidth(310)}
          title="Drag to resize panel (Double-click to reset)"
          style={{
            width: "6px",
            background: "rgba(255, 255, 255, 0.04)",
            cursor: "col-resize",
            zIndex: 30,
            transition: "background 0.15s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          className="resize-handle-col"
        />

        {/* Right ML Predictions Panel */}
        <aside
          className="ide-panel ide-panel-right"
          style={{ width: `${rightWidth}px`, flexShrink: 0, overflow: "hidden" }}
        >
          <div className="panel-tab-header">
            <span className="tab-active">AI SURVIVABILITY & COMBAT DIAGNOSTICS</span>
          </div>
          <div className="panel-content">{rightPanel}</div>
        </aside>
      </div>

      {/* Horizontal Divider (Workspace <-> Bottom Log) */}
      <div
        onMouseDown={() => startDragging("bottom")}
        onDoubleClick={() => setBottomHeight(110)}
        title="Drag to resize console (Double-click to reset)"
        style={{
          height: "6px",
          background: "rgba(255, 255, 255, 0.06)",
          cursor: "row-resize",
          zIndex: 30,
          transition: "background 0.15s ease",
        }}
        className="resize-handle-row"
      />

      {/* Bottom Integrated Terminal / Log Panel (Compact by default) */}
      <footer
        className="ide-panel ide-panel-bottom"
        style={{ height: `${bottomHeight}px`, flexShrink: 0, overflow: "hidden" }}
      >
        {bottomLog}
      </footer>
    </div>
  );
}
