import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { BackendStatusBanner } from "@/components/backend-status-banner";
import { Providers } from "./providers";

// Geist gives the console a real typographic voice (the app previously rendered in the OS
// default sans). Mono carries data-heavy figures so counts and rates align in columns.
const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Looms · Campaign Console",
  description:
    "AI-native mini CRM: state your intent in plain English, review editable segment, message, and launch cards.",
};

// viewport-fit: cover exposes the env(safe-area-inset-*) values so the bottom-docked
// composer can clear the home indicator on notched phones (see console.tsx).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // `dark` is applied at the root: the analytics dashboards and console cards are designed
  // against the dark palette (cool near-black, single iris accent). One place, no flash.
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground antialiased">
        {/* Arm scroll/load reveals before first paint, but only when JS runs AND motion is
            allowed. Without this class, [data-reveal] content stays fully visible — so no-JS,
            reduced-motion, and crawlers never see a hidden (blank) section. Runs synchronously
            ahead of the children below, so there's no flash of unstyled/visible content. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('reveal-on')}catch(e){}",
          }}
        />
        <Providers>
          {children}
          <BackendStatusBanner />
        </Providers>
      </body>
    </html>
  );
}
