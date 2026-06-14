"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Route-level error boundary for the dashboard. Catches render errors and, importantly,
 * chunk-load failures from the lazily-imported charts (a stale hashed chunk after a redeploy
 * is the common case). The dashboard layout (nav) stays mounted; only this panel swaps in,
 * so one failing chart can't blank the whole app. `reset()` re-renders the segment to retry.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for whatever logging the deploy wires up; never swallow silently.
    console.error(error);
  }, [error]);

  const isChunkError = /chunk|dynamically imported module|Loading/i.test(
    error.message,
  );

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-2xl bg-destructive/10 p-4">
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-lg font-medium">
        {isChunkError ? "This page needs a refresh" : "Something went wrong"}
      </h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isChunkError
          ? "Part of this page failed to load, usually because the app updated since you opened it. A refresh loads the latest version."
          : "This view ran into an unexpected error. Your data is safe."}
      </p>
      <button
        onClick={() => (isChunkError ? window.location.reload() : reset())}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
      >
        {isChunkError ? "Reload page" : "Retry"}
      </button>
    </div>
  );
}
