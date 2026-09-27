"use client";

import { ReactNode, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/Icons";

interface Props {
  leftPanel: ReactNode;
  centerCanvas: ReactNode;
  rightPanel: ReactNode;
  bottomLog: ReactNode;
}

// The hologram viewport is the reason this page exists; the telemetry and ML
// panels either side are supporting evidence. Letting either be collapsed
// gives the canvas the full width instead of it being permanently squeezed
// into a fixed 1fr strip between two fixed-width panels.
export function Twin3DLayout({ leftPanel, centerCanvas, rightPanel, bottomLog }: Props) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="twin3d-ide-container">
      <div
        className="ide-workspace"
        style={{
          gridTemplateColumns: `${leftCollapsed ? "36px" : "280px"} 1fr ${rightCollapsed ? "36px" : "310px"}`,
        }}
      >
        <aside className={`ide-panel ide-panel-left ${leftCollapsed ? "collapsed" : ""}`}>
          <div className="panel-tab-header">
            {!leftCollapsed && <span className="tab-active">RADAR SENSOR BUS // MIL-STD-1553</span>}
            <button
              type="button"
              className="panel-collapse-btn"
              onClick={() => setLeftCollapsed((v) => !v)}
              title={leftCollapsed ? "Expand telemetry panel" : "Collapse telemetry panel"}
              aria-expanded={!leftCollapsed}
            >
              {leftCollapsed ? <IconChevronRight width={13} height={13} /> : <IconChevronLeft width={13} height={13} />}
            </button>
          </div>
          {!leftCollapsed && <div className="panel-content">{leftPanel}</div>}
        </aside>

        <main className="ide-panel ide-panel-center">
          <div className="panel-tab-header">
            <span className="tab-active">3D HOLOGRAPHIC DIGITAL TWIN</span>
            <span className="tab-sub">ROTAX 915 iS (MALE UAV)</span>
          </div>
          <div className="canvas-wrapper-container">{centerCanvas}</div>
        </main>

        <aside className={`ide-panel ide-panel-right ${rightCollapsed ? "collapsed" : ""}`}>
          <div className="panel-tab-header">
            <button
              type="button"
              className="panel-collapse-btn"
              onClick={() => setRightCollapsed((v) => !v)}
              title={rightCollapsed ? "Expand AI/ML panel" : "Collapse AI/ML panel"}
              aria-expanded={!rightCollapsed}
            >
              {rightCollapsed ? <IconChevronLeft width={13} height={13} /> : <IconChevronRight width={13} height={13} />}
            </button>
            {!rightCollapsed && <span className="tab-active">AI SURVIVABILITY & COMBAT DIAGNOSTICS</span>}
          </div>
          {!rightCollapsed && <div className="panel-content">{rightPanel}</div>}
        </aside>
      </div>

      <footer className="ide-panel ide-panel-bottom">{bottomLog}</footer>
    </div>
  );
}
