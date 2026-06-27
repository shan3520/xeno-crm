"use client";

import { useQuery } from "@tanstack/react-query";

import {
  fetchCampaignStats,
  type CampaignStatsResponse,
} from "@/lib/analytics-api";

/**
 * TanStack Query hook for a single campaign's stats.
 *
 * Polls every 2 seconds while the campaign status is SENDING or LAUNCHING,
 * and falls back to refetch-on-window-focus otherwise.
 *
 * refetchIntervalInBackground keeps the funnel advancing even when this tab isn't the
 * foreground one — without it, the interval pauses on a backgrounded tab (document.hidden)
 * and the just-launched campaign looks frozen at a mid-send snapshot until the user clicks
 * back and triggers a focus refetch. A live send is exactly when a marketer tabs away to do
 * something else, so the numbers must keep moving regardless of focus.
 */
export function useCampaignStats(campaignId: string) {
  return useQuery<CampaignStatsResponse>({
    queryKey: ["campaign-stats", campaignId],
    queryFn: () => fetchCampaignStats(campaignId),
    refetchInterval: (query) => {
      const status = query.state.data?.campaign.status;
      if (status === "SENDING" || status === "LAUNCHING") return 2000;
      return false;
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}
