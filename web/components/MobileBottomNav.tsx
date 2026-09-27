"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  onOpenGuide?: () => void;
}

export function MobileBottomNav({ onOpenGuide }: Props) {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isFleet = pathname === "/fleet" || (pathname.startsWith("/uav") && !pathname.includes("/twin3d"));
  const is3DTwin = pathname.includes("/twin3d");

  return (
    <nav className="mobile-bottom-nav">
      <Link href="/" className={`mobile-nav-item ${isHome ? "active" : ""}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
        <span>Dashboard</span>
      </Link>

      <Link href="/fleet" className={`mobile-nav-item ${isFleet ? "active" : ""}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
        </svg>
        <span>Fleet</span>
      </Link>

      <Link href="/uav/uav-01/twin3d" className={`mobile-nav-item ${is3DTwin ? "active" : ""}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21 16-9 5-9-5V8l9-5 9 5v8z" />
          <path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12" />
        </svg>
        <span>3D Twin</span>
      </Link>

      <button
        type="button"
        className="mobile-nav-item"
        onClick={onOpenGuide}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ fontSize: 20 }}>💡</span>
        <span>Guide</span>
      </button>
    </nav>
  );
}
