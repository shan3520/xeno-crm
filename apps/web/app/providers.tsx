"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * The SINGLE app-wide TanStack Query provider. It lives at the root layout so the
 * conversational console and the analytics dashboards share one QueryClient — the campaigns
 * layout used to mount its own scoped provider, which would double-wrap once the console (also
 * a Query consumer) sits above it. Defaults mirror the previous analytics-scoped client.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: 2,
            // The app has no offline mode — it talks to a known backend over the internet. With
            // the default networkMode "online", React Query PAUSES a query (status "pending",
            // fetchStatus "paused", null error) whenever its online-detection thinks the browser
            // is offline — which misfires in CDP/automation browsers, behind some VPNs/proxies,
            // and on transient navigator.onLine flips. A paused query never fires the fetch, so
            // the funnel looks frozen and a bad-id page falls to the null-error branch instead of
            // a real 404 → "Campaign not found". "always" fires regardless; genuine network
            // failures then surface as real errors the UI already handles.
            networkMode: "always",
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
