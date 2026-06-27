import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";

import { LoomsMark } from "@/components/landing/previews";

/**
 * App-wide 404. Without this, an unknown URL (a mistyped path or a stale link) falls through
 * to Next's unstyled default with no branding and no way back into the product. This renders
 * inside the root layout (dark palette + fonts), so it stays on-brand and always offers a
 * route home or into the console.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 py-16 text-center text-foreground">
      <Link
        href="/"
        className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        aria-label="Looms home"
      >
        <LoomsMark className="block h-8 w-8" />
        <span className="text-lg font-semibold tracking-tight">Looms</span>
      </Link>

      <div className="mt-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 text-brand ring-1 ring-inset ring-brand/25">
        <Compass className="h-7 w-7" aria-hidden="true" />
      </div>

      <p className="mt-6 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
        This page wandered off.
      </h1>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have moved. Let&apos;s get
        you back to building campaigns.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/console"
          className="group inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition duration-200 hover:bg-primary/90 hover:shadow-elevated active:scale-[0.98]"
        >
          Open the console
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background/50 px-5 py-3 text-sm font-medium text-foreground transition duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:bg-accent active:scale-[0.98]"
        >
          View campaigns
        </Link>
      </div>
    </main>
  );
}
