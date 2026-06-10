"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchAnalyticsOverview,
  type OverviewResponse,
} from "@/lib/analytics-api";

/**
 * TanStack Query hook for the workspace-wide analytics overview.
 * No live polling — refetches on window focus only.
 */
export function useAnalyticsOverview() {
  return useQuery<OverviewResponse>({
    queryKey: ["analytics-overview"],
    queryFn: fetchAnalyticsOverview,
    refetchOnWindowFocus: true,
  });
}
