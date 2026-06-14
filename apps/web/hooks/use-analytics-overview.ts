"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchAnalyticsOverview,
  type OverviewResponse,
} from "@/lib/analytics-api";

/**
 * TanStack Query hook for the workspace-wide analytics overview.
 *
 * Polls every 5s while any campaign is still SENDING or LAUNCHING, so the list's "Live"
 * badge and the per-row counters actually move while a send drains — instead of going stale
 * until the next window focus. Once everything is COMPLETED, polling stops and it falls back
 * to refetch-on-window-focus.
 */
export function useAnalyticsOverview() {
  return useQuery<OverviewResponse>({
    queryKey: ["analytics-overview"],
    queryFn: fetchAnalyticsOverview,
    refetchInterval: (query) => {
      const hasLive = query.state.data?.campaigns.some(
        (c) => c.status === "SENDING" || c.status === "LAUNCHING",
      );
      return hasLive ? 5000 : false;
    },
    refetchOnWindowFocus: true,
  });
}
