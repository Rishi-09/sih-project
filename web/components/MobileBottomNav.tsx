"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrimaryEngineId } from "@/lib/useEngineId";

interface Props {
  onOpenGuide?: () => void;
}

export function MobileBottomNav({ onOpenGuide }: Props) {
  const pathname = usePathname();
  const engineId = usePrimaryEngineId();
  const consoleHref = engineId ? `/uav/${engineId}` : "/fleet";
  const twinHref = engineId ? `/uav/${engineId}/twin3d` : "/fleet";

  const isHome = pathname === "/";
  const is3DTwin = pathname.includes("/twin3d");
  const isConsole = pathname.startsWith("/uav") && !is3DTwin;
  const isFleet = pathname === "/fleet";

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary">
      <Link href="/" className={`mobile-nav-item ${isHome ? "active" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="8" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="11" width="7" height="10" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
        <span>Command</span>
      </Link>

      <Link href={consoleHref} className={`mobile-nav-item ${isConsole ? "active" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v4.5l3 2" />
        </svg>
        <span>Engine</span>
      </Link>

      <Link href={twinHref} className={`mobile-nav-item ${is3DTwin ? "active" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
          <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
        </svg>
        <span>Twin</span>
      </Link>

      <Link href="/fleet" className={`mobile-nav-item ${isFleet ? "active" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
        </svg>
        <span>Fleet</span>
      </Link>

      <button type="button" className="mobile-nav-item" onClick={onOpenGuide}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 17h.01" />
        </svg>
        <span>Guide</span>
      </button>
    </nav>
  );
}
