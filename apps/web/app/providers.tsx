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
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
