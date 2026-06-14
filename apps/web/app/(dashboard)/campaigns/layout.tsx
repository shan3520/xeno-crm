import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { MessageSquarePlus, Wand2 } from "lucide-react";

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
    <div className="min-h-[100dvh] bg-background">
      {/* Slim top bar — gives the dashboard the same identity as the console and a way back. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/"
            title="Back to home"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
              <Wand2 className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Looms
            </span>
          </Link>
          <Link
            href="/console"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.98]"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New campaign
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
