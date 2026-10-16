import "./globals.css";
import "./dashboard.css";
import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "RETRIBUTION Aero Twin — MALE UAV Piston Engine Digital Twin",
  description: "AI-Enabled Digital Twin & Mission Reliability Platform for Rotax 915 iS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
