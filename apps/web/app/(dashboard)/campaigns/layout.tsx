import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AnalyticsQueryProvider } from "./providers";

export const metadata: Metadata = {
  title: "Campaigns | Xeno CRM",
  description: "Campaign analytics and performance dashboards.",
};

export default function CampaignsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AnalyticsQueryProvider>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </div>
    </AnalyticsQueryProvider>
  );
}
