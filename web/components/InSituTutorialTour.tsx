"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";

export interface TutorialStep {
  id: string;
  targetSelector: string;
  fallbackSelector?: string;
  title: string;
  description: string;
  actionHint: string;
  placement?: "top" | "bottom" | "left" | "right";
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "step-start-sortie",
    targetSelector: "#btn-start-sortie",
    fallbackSelector: ".btn-primary",
    title: "1. Launch Sortie & FADEC Stream",
    description: "Click 'Start sortie' to ignite the Rotax 915 iS engine. This starts the physics simulation and streams real-time 1 Hz sensor telemetry.",
    actionHint: "Press 'Start sortie' or click Next to continue",
    placement: "bottom",
  },
  {
    id: "step-3d-modes",
    targetSelector: ".render-mode-group",
    fallbackSelector: "#mini-twin-container",
    title: "2. 3D Digital Twin Shading",
    description: "Interact with the Rotax 915 iS engine in 3D. Switch between Solid CAD, Wireframe skeleton, and FLIR Thermal to inspect real-time cylinder heat dissipation.",
    actionHint: "Try clicking THERMAL or WIREFRAME",
    placement: "bottom",
  },
  {
    id: "step-fault-injection",
    targetSelector: ".control-group-fault",
    fallbackSelector: ".fault-btn-group",
    title: "3. Anomaly & Fault Injection",
    description: "Simulate emergency conditions: select an engine fault (cooling restriction, lubrication drop, weak cylinder) and adjust severity to test the AI's diagnosis.",
    actionHint: "Select a fault and click Inject fault",
    placement: "top",
  },
  {
    id: "step-mission-status",
    targetSelector: ".mission",
    fallbackSelector: ".console-col-left",
    title: "4. Mission Reliability & Advisory",
    description: "The digital twin's AI evaluates endurance margin and mission success probability, issuing real-time advisories (Continue, Derate, Return to Base, or Land).",
    actionHint: "Inspect live recommendations and safe endurance",
    placement: "bottom",
  },
  {
    id: "step-limiters-whatif",
    targetSelector: ".decision-card",
    fallbackSelector: ".decision-grid",
    title: "5. Limiters & Power Derate Planner",
    description: "View binding constraints (EGT, CHT, oil pressure) and drag the What-If throttle slider to evaluate how reducing power extends safe flight endurance.",
    actionHint: "Explore what-if derate options",
    placement: "top",
  },
  {
    id: "step-ai-scan",
    targetSelector: "#btn-topbar-run-scan",
    fallbackSelector: ".topbar-search",
    title: "6. Fleet-Wide AI Diagnostic Scan",
    description: "Run automated neural diagnostics across the entire MALE UAV fleet to detect micro-anomalies and prevent in-flight engine failures.",
    actionHint: "Click Run scan anytime for full fleet debrief",
    placement: "bottom",
  },
];

interface Props {
  isActive: boolean;
  onClose: () => void;
}

export function InSituTutorialTour({ isActive, onClose }: Props) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [targetFound, setTargetFound] = useState(true);
  const animFrameRef = useRef<number | null>(null);

  const step = TUTORIAL_STEPS[currentStepIdx];

  const updateTargetRect = useCallback(() => {
    if (!step) return;
    let el = document.querySelector(step.targetSelector) as HTMLElement | null;
    if (!el && step.fallbackSelector) {
      el = document.querySelector(step.fallbackSelector) as HTMLElement | null;
    }

    if (el) {
      const r = el.getBoundingClientRect();
      setRect(r);
      setTargetFound(true);

      // Auto-scroll target into view if outside viewport
      if (r.top < 70 || r.bottom > window.innerHeight - 50) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else {
      setTargetFound(false);
      setRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!isActive) return;

    updateTargetRect();

    const handleResizeOrScroll = () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(updateTargetRect);
    };

    window.addEventListener("resize", handleResizeOrScroll);
    window.addEventListener("scroll", handleResizeOrScroll, true);

    const interval = setInterval(updateTargetRect, 800);

    return () => {
      window.removeEventListener("resize", handleResizeOrScroll);
      window.removeEventListener("scroll", handleResizeOrScroll, true);
      clearInterval(interval);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isActive, updateTargetRect]);

  if (!isActive || !step) return null;

  const handleNext = () => {
    if (currentStepIdx < TUTORIAL_STEPS.length - 1) {
      setCurrentStepIdx((prev) => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx((prev) => prev - 1);
    }
  };

  // Calculate tooltip coordinates relative to spotlight rect
  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 1000002,
    width: "340px",
    maxWidth: "92vw",
    background: "#0a1015",
    border: "1px solid #54c6d1",
    borderRadius: "10px",
    padding: "16px 18px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.85), 0 0 16px rgba(84, 198, 209, 0.3)",
    color: "#fff",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
  };

  if (rect && targetFound) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (step.placement === "top" || (spaceBelow < 220 && spaceAbove > 200)) {
      tooltipStyle.bottom = `${window.innerHeight - rect.top + 14}px`;
      tooltipStyle.left = `${Math.max(16, Math.min(window.innerWidth - 360, rect.left + rect.width / 2 - 170))}px`;
    } else {
      tooltipStyle.top = `${rect.bottom + 14}px`;
      tooltipStyle.left = `${Math.max(16, Math.min(window.innerWidth - 360, rect.left + rect.width / 2 - 170))}px`;
    }
  } else {
    // Center fallback if target element is hidden/absent
    tooltipStyle.top = "50%";
    tooltipStyle.left = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }

  return (
    <>
      {/* 1. Backdrop darkener */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2, 6, 10, 0.68)",
          zIndex: 1000000,
          pointerEvents: "auto",
        }}
        onClick={onClose}
      />

      {/* 2. Spotlight Cutout / Glowing Pulsing Reticle around target */}
      {rect && targetFound && (
        <div
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: "8px",
            border: "2px solid #54c6d1",
            boxShadow: "0 0 0 9999px rgba(3, 7, 12, 0.72), 0 0 20px rgba(84, 198, 209, 0.7)",
            zIndex: 1000001,
            pointerEvents: "none",
            animation: "pulse-glow 1.8s ease-in-out infinite alternate",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      )}

      {/* 3. Floating Interactive Tooltip */}
      <div style={tooltipStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                background: "#0284c7",
                color: "#fff",
                fontSize: "10px",
                fontWeight: 800,
                padding: "2px 6px",
                borderRadius: "4px",
                letterSpacing: "0.06em",
              }}
            >
              STEP {currentStepIdx + 1}/{TUTORIAL_STEPS.length}
            </span>
            <span style={{ fontSize: "11px", color: "#54c6d1", fontWeight: 700 }}>TACTICAL TOUR</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "16px",
              padding: "2px 6px",
              lineHeight: 1,
            }}
            title="Exit tutorial"
          >
            ✕
          </button>
        </div>

        <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>
          {step.title}
        </h4>

        <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
          {step.description}
        </p>

        <div
          style={{
            background: "rgba(84, 198, 209, 0.08)",
            border: "1px dashed rgba(84, 198, 209, 0.3)",
            borderRadius: "6px",
            padding: "6px 10px",
            fontSize: "11px",
            color: "#38bdf8",
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: "12px",
          }}
        >
          <span>👉</span>
          <span style={{ fontWeight: 600 }}>{step.actionHint}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#94a3b8",
              padding: "5px 10px",
              borderRadius: "5px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Skip Tour
          </button>

          <div style={{ display: "flex", gap: "8px" }}>
            {currentStepIdx > 0 && (
              <button
                onClick={handlePrev}
                style={{
                  background: "#1e293b",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#e2e8f0",
                  padding: "5px 12px",
                  borderRadius: "5px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            )}

            <button
              onClick={handleNext}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                border: "1px solid #38bdf8",
                color: "#ffffff",
                padding: "5px 14px",
                borderRadius: "5px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
              }}
            >
              <span>{currentStepIdx === TUTORIAL_STEPS.length - 1 ? "Finish Tour 🏁" : "Next →"}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
