"use client";

import { useEffect, useRef, useState } from "react";
import { tacticalAudio } from "@/lib/tacticalAudio";
import { TickFrame } from "@/lib/types";

interface Props {
  frame?: TickFrame | null;
  tail?: string;
  isCombatMode?: boolean;
  onToggleCombatMode?: () => void;
}

export function TacticalRadarHUD({ frame, tail = "UAV-01", isCombatMode = false, onToggleCombatMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioActive, setAudioActive] = useState(false);
  const [coords] = useState({ lat: "34° 08' 22\" N", lon: "74° 47' 55\" E", sector: "NORTHERN COMMAND // SECTOR ALPHA" });
  const [timeStr, setTimeStr] = useState("");

  // Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const ist = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });
      const utc = now.toISOString().slice(11, 19);
      setTimeStr(`IST ${ist} | ZULU ${utc}Z`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Audio Toggle
  const handleToggleAudio = () => {
    const state = tacticalAudio.toggle();
    setAudioActive(state);
    if (state) {
      tacticalAudio.playRadarPing();
    }
  };

  // Canvas radar animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let angle = 0;
    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(cx, cy) - 8;

      ctx.clearRect(0, 0, w, h);

      // Radar Scope Background
      ctx.fillStyle = isCombatMode ? "rgba(35, 10, 10, 0.9)" : "rgba(8, 16, 10, 0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Range Rings
      const ringColor = isCombatMode ? "rgba(248, 113, 113, 0.25)" : "rgba(74, 222, 128, 0.22)";
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1;

      [0.3, 0.6, 0.95].forEach((pct) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r * pct, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // Radar Sweep Beam
      const sweepGradient = ctx.createConicGradient(angle, cx, cy);
      if (isCombatMode) {
        sweepGradient.addColorStop(0, "rgba(239, 68, 68, 0.45)");
        sweepGradient.addColorStop(0.12, "rgba(239, 68, 68, 0.0)");
        sweepGradient.addColorStop(1, "rgba(239, 68, 68, 0.0)");
      } else {
        sweepGradient.addColorStop(0, "rgba(74, 222, 128, 0.45)");
        sweepGradient.addColorStop(0.12, "rgba(74, 222, 128, 0.0)");
        sweepGradient.addColorStop(1, "rgba(74, 222, 128, 0.0)");
      }

      ctx.fillStyle = sweepGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Sweep Line Leading Edge
      ctx.strokeStyle = isCombatMode ? "#f87171" : "#4ade80";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();

      // Target Blip (Own UAV center)
      ctx.fillStyle = isCombatMode ? "#f87171" : "#ff9933";
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Secondary target / beacon blip
      const bx = cx + Math.cos(1.2) * (r * 0.58);
      const by = cy + Math.sin(1.2) * (r * 0.58);
      ctx.fillStyle = isCombatMode ? "#fbbf24" : "#38bdf8";
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, Math.PI * 2);
      ctx.fill();

      // Heading indicator triangle
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(cx, cy - r + 3);
      ctx.lineTo(cx - 4, cy - r + 9);
      ctx.lineTo(cx + 4, cy - r + 9);
      ctx.closePath();
      ctx.fill();

      angle = (angle + 0.035) % (Math.PI * 2);
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isCombatMode]);

  const rpm = frame?.sensors?.rpm ?? 5200;
  const map = frame?.sensors?.map ?? 1.35;
  const coolant = frame?.sensors?.coolant_temp ?? 84;
  const ehi = frame?.health?.ehi ?? 98;

  return (
    <div className={`tactical-radar-hud ${isCombatMode ? "combat-hud-active" : ""}`}>
      <div className="radar-hud-header">
        <div className="hud-title-section">
          <span className="hud-callsign">TAPAS-T1 // {tail}</span>
          <span className="hud-sector">{coords.sector}</span>
        </div>
        <div className="hud-actions-right">
          <span className="hud-clock">{timeStr}</span>
          <button
            type="button"
            className={`hud-btn ${audioActive ? "hud-btn-active" : ""}`}
            onClick={handleToggleAudio}
            title="Toggle Tactical Audio Telemetry"
          >
            {audioActive ? "🔊 HUD COMM: ON" : "🔇 COMM MUTE"}
          </button>
          {onToggleCombatMode && (
            <button
              type="button"
              className={`hud-btn hud-combat-btn ${isCombatMode ? "combat-flashing" : ""}`}
              onClick={() => {
                tacticalAudio.playCombatAlert();
                onToggleCombatMode();
              }}
            >
              {isCombatMode ? "⚠ DEFCON-1 ACTIVE" : "⚔ ENGAGE DEFCON-1"}
            </button>
          )}
        </div>
      </div>

      <div className="radar-hud-body">
        {/* Left: Tactical Radar Canvas */}
        <div className="radar-canvas-container">
          <canvas ref={canvasRef} width={130} height={130} className="radar-canvas" />
          <div className="radar-label-coords">
            <div>LAT: {coords.lat}</div>
            <div>LON: {coords.lon}</div>
          </div>
        </div>

        {/* Center: Live Avionics Tape */}
        <div className="avionics-telemetry-cluster">
          <div className="av-chip">
            <span className="av-k">GRID ALT</span>
            <span className="av-v">14,280 <span className="av-u">FT MSL</span></span>
          </div>
          <div className="av-chip">
            <span className="av-k">AIRSPEED (TAS)</span>
            <span className="av-v">118 <span className="av-u">KTS</span></span>
          </div>
          <div className="av-chip">
            <span className="av-k">SATCOM LINK</span>
            <span className="av-v" style={{ color: "var(--radar-cyan)" }}>GSAT-7A <span className="av-u">L-BAND</span></span>
          </div>
          <div className="av-chip">
            <span className="av-k">ENGINE RPM</span>
            <span className="av-v">{Math.round(rpm)} <span className="av-u">RPM</span></span>
          </div>
          <div className="av-chip">
            <span className="av-k">TURBO BOOST</span>
            <span className="av-v">{map.toFixed(2)} <span className="av-u">BAR</span></span>
          </div>
          <div className="av-chip">
            <span className="av-k">COOLANT TEMP</span>
            <span className="av-v">{coolant.toFixed(1)} <span className="av-u">°C</span></span>
          </div>
        </div>

        {/* Right: IFF & Encryption Badge */}
        <div className="iff-status-box">
          <div className="iff-row">
            <span className="iff-badge-pill">IFF MODE 5: FRIENDLY</span>
          </div>
          <div className="iff-crypto">
            <div className="crypto-title">SHAKTI-512 SECURE BUS</div>
            <div className="crypto-hash">MIL-STD-1553B // AIR-TO-GROUND LINK OK</div>
          </div>
          <div className="combat-ready-status">
            {isCombatMode ? (
              <span className="combat-status-crit">⚠ HOSTILE THREAT PROTOCOL ENGAGED</span>
            ) : (
              <span className="combat-status-ok">✔ WEAPONS & TELEMETRY ARMED</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
