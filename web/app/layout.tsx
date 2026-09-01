import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Piston Twin Console",
  description: "AI-Enabled Digital Twin — MALE UAV Aero Piston Engine (Rotax 915 iS)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
