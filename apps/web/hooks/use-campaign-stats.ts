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
    refetchOnWindowFocus: true,
  });
}
