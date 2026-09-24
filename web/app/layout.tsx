import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "UAV Engine Health Monitoring | Rotax 915 iS Digital Twin",
  description: "Aero Piston Digital Twin & Real-time Diagnostic Console (Rotax 915 iS)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top-system-nav">
          <div className="nav-brand">
            <img src="/drdo-logo.png" alt="DRDO Logo" className="drdo-nav-logo" />
            <span className="brand-title">DRDO AERO-TWIN</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
