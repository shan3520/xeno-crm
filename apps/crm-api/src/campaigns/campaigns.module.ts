import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

/**
 * Campaigns: create drafts and launch them (audience snapshot -> QUEUED Communications ->
 * SENDING). Depends on CustomersModule for the single-workspace resolver; reuses the segment
 * compiler directly for audience resolution. Sends nothing — the worker drains the queue.
 */
@Module({
  imports: [CustomersModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
