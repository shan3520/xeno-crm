"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCrmHealth } from "@/lib/analytics-api";

const REVEAL_AFTER_MS = 2_500;

export function BackendStatusBanner() {
  // `visible` is set once after the grace period; it never resets — the render condition
  // handles hiding via `isSuccess`. This avoids the bug where tracking `isSuccess` in the
  // effect dependency caused the banner to persist when the query exhausted all retries
  // (isError state: isSuccess stays false, setReveal(false) is never called).
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { isSuccess } = useQuery({
    queryKey: ["crm-health"],
    queryFn: fetchCrmHealth,
    retry: 10,
    retryDelay: 3_000,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  // isSuccess hides the banner the moment the query resolves, regardless of `visible`.
  if (isSuccess || !visible || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div className="flex max-w-xl items-center gap-3 rounded-2xl border border-warning/30 bg-background/90 px-4 py-3 text-sm shadow-lg backdrop-blur">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-warning" />
        <p className="flex-1 text-muted-foreground">
          <span className="font-medium text-foreground">Waking up the backend…</span>{" "}
          Free-tier services sleep when idle, so the first load can take up to ~60s. This is
          normal; it&rsquo;ll continue automatically, no action needed.
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
