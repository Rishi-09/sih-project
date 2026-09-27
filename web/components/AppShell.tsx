"use client";

import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { OperatorGuideModal } from "./OperatorGuideModal";

interface Props {
  children: React.ReactNode;
}

export function AppShell({ children }: Props) {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar onOpenGuide={() => setGuideOpen(true)} />
      <div className="app-main-content">
        <TopBar onOpenGuide={() => setGuideOpen(true)} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
      <OperatorGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
