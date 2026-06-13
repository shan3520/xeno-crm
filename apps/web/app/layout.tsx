import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { BackendStatusBanner } from "@/components/backend-status-banner";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Looms · Campaign Console",
  description:
    "AI-native mini CRM — state your intent in plain English, review editable segment, message, and launch cards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // `dark` is applied at the root: the analytics dashboards and console cards are designed
  // against the dark palette (zinc/blue/emerald on a near-black canvas). One place, no flash.
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased">
        <Providers>
          {children}
          <BackendStatusBanner />
        </Providers>
      </body>
    </html>
  );
}
