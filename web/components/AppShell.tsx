"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileBottomNav } from "./MobileBottomNav";
import { OperatorGuideModal } from "./OperatorGuideModal";
import { TutorialScenarioModal } from "./TutorialScenarioModal";

interface Props {
  children: React.ReactNode;
}

interface BackgroundSortie {
  runId: string;
  engineId: string;
  tail: string;
  startedAt: number;
}

export function AppShell({ children }: Props) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [bgSortie, setBgSortie] = useState<BackgroundSortie | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  useEffect(() => {
    const checkBgSortie = () => {
      try {
        const raw = sessionStorage.getItem("active_sortie");
        if (raw) {
          const parsed: BackgroundSortie = JSON.parse(raw);
          const elapsed = Math.floor((Date.now() - parsed.startedAt) / 1000);
          const rem = Math.max(0, 75 - elapsed);
          if (rem > 0) {
            setBgSortie(parsed);
            setRemainingSec(rem);
          } else {
            setBgSortie(null);
          }
        } else {
          setBgSortie(null);
        }
      } catch {
        setBgSortie(null);
      }
    };

    checkBgSortie();
    const timer = setInterval(checkBgSortie, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        onOpenGuide={() => setGuideOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
      />
      <div className="app-main-content">
        <TopBar
          onOpenGuide={() => setGuideOpen(true)}
          onOpenTutorial={() => setTutorialOpen(true)}
        />
        <div className="app-page-body" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
        <MobileBottomNav
          onOpenGuide={() => setGuideOpen(true)}
          onOpenTutorial={() => setTutorialOpen(true)}
        />
      </div>

      {/* Floating Status Pill when Sortie is running in the background */}
      {bgSortie && remainingSec > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: "75px",
            right: "24px",
            zIndex: 9999,
            background: "#0c1318",
            border: "1px solid rgba(56, 189, 248, 0.5)",
            borderRadius: "30px",
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.85), 0 0 15px rgba(56, 189, 248, 0.25)",
            animation: "fade-in 0.2s ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px" }}>⚙️</span>
            <span style={{ fontSize: "12px", color: "#f8fafc", fontWeight: 600 }}>
              {bgSortie.tail} Spooling ({remainingSec}s)
            </span>
          </div>
          <Link
            href={`/uav/${bgSortie.engineId}`}
            style={{
              background: "#0284c7",
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "14px",
              textDecoration: "none",
            }}
          >
            Cockpit →
          </Link>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem("active_sortie");
              setBgSortie(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: "14px",
              cursor: "pointer",
              padding: "0 4px",
            }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <OperatorGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
      <TutorialScenarioModal isOpen={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </div>
  );
}
