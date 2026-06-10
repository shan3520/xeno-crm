import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Campaigns | Looms",
  description: "Campaign analytics and performance dashboards.",
};

// NOTE: the QueryClientProvider is now mounted ONCE at the root layout (app/providers.tsx).
// This layout no longer wraps its own — doing so would double-wrap now that the console (a
// Query consumer) and these dashboards share the app tree.
export default function CampaignsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
