"use client";

import { ReactNode } from "react";

interface Props {
  leftPanel: ReactNode;
  centerCanvas: ReactNode;
  rightPanel: ReactNode;
  bottomLog: ReactNode;
}

export function Twin3DLayout({ leftPanel, centerCanvas, rightPanel, bottomLog }: Props) {
  return (
    <div className="twin3d-ide-container">
      <div className="ide-workspace">
        {/* Left Simulator Telemetry Panel */}
        <aside className="ide-panel ide-panel-left">
          <div className="panel-tab-header">
            <span className="tab-active">RADAR SENSOR BUS // MIL-STD-1553</span>
          </div>
          <div className="panel-content">{leftPanel}</div>
        </aside>

        {/* Center 3D Hologram Viewport */}
        <main className="ide-panel ide-panel-center">
          <div className="panel-tab-header">
            <span className="tab-active">3D HOLOGRAPHIC DIGITAL TWIN</span>
            <span className="tab-sub">ROTAX 915 iS (MALE UAV)</span>
          </div>
          <div className="canvas-wrapper-container">{centerCanvas}</div>
        </main>

        {/* Right ML Predictions Panel */}
        <aside className="ide-panel ide-panel-right">
          <div className="panel-tab-header">
            <span className="tab-active">AI SURVIVABILITY & COMBAT DIAGNOSTICS</span>
          </div>
          <div className="panel-content">{rightPanel}</div>
        </aside>
      </div>

      {/* Bottom Integrated Terminal / Log Panel */}
      <footer className="ide-panel ide-panel-bottom">
        {bottomLog}
      </footer>
    </div>
  );
}
