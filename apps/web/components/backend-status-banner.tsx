"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCrmHealth } from "@/lib/analytics-api";

/**
 * Cold-start banner for the free-tier backend.
 *
 * The crm-api + channel-stub run on Render's free tier and spin down after ~15 min idle, so the
 * first request after a quiet period waits ~50s while the service wakes. Without feedback that
 * reads as "the app is frozen / broken." This component:
 *
 *   1. PINGS crm-api /health on mount — which both detects a sleeping backend AND triggers the
 *      wake-up just by loading the page (the evaluator never has to "warm it up" manually).
 *   2. Shows a calm, self-explanatory toast ONLY if the backend doesn't respond quickly (a short
 *      grace period avoids a flash when it's already warm), and keeps retrying.
 *   3. Auto-dismisses the moment the backend is reachable.
 *
 * It renders nothing when the backend is warm, so there is no cost to the normal path.
 */

/** Don't reveal the banner unless the backend is still unreachable after this long (avoids a flash). */
const REVEAL_AFTER_MS = 2_500;

export function BackendStatusBanner() {
  const [reveal, setReveal] = useState(false);

  const { isSuccess } = useQuery({
    queryKey: ["crm-health"],
    queryFn: fetchCrmHealth,
    // Keep trying through a cold start: a hang resolves on wake (~50s); a mid-wake 5xx retries.
    retry: 20,
    retryDelay: 2_000,
    refetchOnWindowFocus: false,
    // Once warm, never re-check for the rest of the session.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (isSuccess) {
      setReveal(false);
      return;
    }
    const timer = setTimeout(() => setReveal(true), REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isSuccess]);

  if (isSuccess || !reveal) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
    >
      <div className="flex max-w-xl items-center gap-3 rounded-2xl border border-warning/30 bg-background/90 px-4 py-3 text-sm shadow-lg backdrop-blur">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-warning" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Waking up the backend…</span>{" "}
          Free-tier services sleep when idle, so the first load can take up to ~60s. This is
          normal; it&rsquo;ll continue automatically, no action needed.
        </p>
      </div>
    </div>
  );
}
