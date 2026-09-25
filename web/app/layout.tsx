import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fleet Twin",
  description: "Physics-hybrid engine digital twin: fleet health, diagnosis, survival and mission advisory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
