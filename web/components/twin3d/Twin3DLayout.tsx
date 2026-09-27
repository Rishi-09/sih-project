"use client";

import { ReactNode, useState, useEffect, useRef } from "react";

interface Props {
  leftPanel: ReactNode;
  centerCanvas: ReactNode;
  rightPanel: ReactNode;
  bottomLog: ReactNode;
}

export function Twin3DLayout({ leftPanel, centerCanvas, rightPanel, bottomLog }: Props) {
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(310);
  const [bottomHeight, setBottomHeight] = useState(160);

  const isDraggingRef = useRef<"left" | "right" | "bottom" | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      if (isDraggingRef.current === "left") {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setLeftWidth(newWidth);
      } else if (isDraggingRef.current === "right") {
        const newWidth = Math.max(220, Math.min(550, window.innerWidth - e.clientX));
        setRightWidth(newWidth);
      } else if (isDraggingRef.current === "bottom") {
        const newHeight = Math.max(80, Math.min(400, window.innerHeight - e.clientY));
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
  }, []);

  const startDragging = (type: "left" | "right" | "bottom") => {
    isDraggingRef.current = type;
    document.body.style.cursor = type === "bottom" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  };

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
            <span className="tab-active">SIMULATOR TELEMETRY</span>
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

        {/* Center 3D Hologram Viewport */}
        <main
          className="ide-panel ide-panel-center"
          style={{ flex: 1, minWidth: "300px", overflow: "hidden", position: "relative" }}
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
            <span className="tab-active">AI / ML PREDICTOR</span>
          </div>
          <div className="panel-content">{rightPanel}</div>
        </aside>
      </div>

      {/* Horizontal Divider (Workspace <-> Bottom Log) */}
      <div
        onMouseDown={() => startDragging("bottom")}
        onDoubleClick={() => setBottomHeight(160)}
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

      {/* Bottom Integrated Terminal / Log Panel */}
      <footer
        className="ide-panel ide-panel-bottom"
        style={{ height: `${bottomHeight}px`, flexShrink: 0, overflow: "hidden" }}
      >
        {bottomLog}
      </footer>
    </div>
  );
}
