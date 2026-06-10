import { Controller, Get, Param } from "@nestjs/common";

import { AnalyticsService } from "./analytics.service";
import type { CampaignStatsResponse, OverviewResponse } from "./analytics.types";

@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * GET /campaigns/:id/stats
   * Returns funnel counts, derived rates, failure breakdown, timeline, and revenue
   * for a single campaign. Headline counts come from the projection-cache columns;
   * timeline and failure breakdown come from grouped event/communication queries.
   */
  @Get("campaigns/:id/stats")
  getCampaignStats(
    @Param("id") id: string,
  ): Promise<CampaignStatsResponse> {
    return this.analytics.getCampaignStats(id);
  }

  /**
   * GET /analytics/overview
   * Returns aggregates across all campaigns for the single seeded workspace:
   * totals, derived rates, and per-campaign summary rows.
   */
  @Get("analytics/overview")
  getOverview(): Promise<OverviewResponse> {
    return this.analytics.getOverview();
  }
}
