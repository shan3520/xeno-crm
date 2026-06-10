import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { CampaignCreateDto } from "./campaigns.dto";
import {
  CampaignsService,
  type CampaignResponse,
  type LaunchResponse,
} from "./campaigns.service";

@Controller("campaigns")
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** POST /campaigns — create a DRAFT (counters 0). */
  @Post()
  create(@Body() dto: CampaignCreateDto): Promise<CampaignResponse> {
    return this.campaigns.create(dto);
  }

  /** GET /campaigns — list campaigns with status + counters. */
  @Get()
  list(): Promise<CampaignResponse[]> {
    return this.campaigns.list();
  }

  /** GET /campaigns/:id — one campaign. */
  @Get(":id")
  getOne(@Param("id") id: string): Promise<CampaignResponse> {
    return this.campaigns.getOne(id);
  }

  /**
   * POST /campaigns/:id/launch — freeze the audience, write QUEUED Communications, flip to
   * SENDING. Does not send. 409 if the campaign is not launchable (e.g. already SENDING).
   */
  @Post(":id/launch")
  launch(@Param("id") id: string): Promise<LaunchResponse> {
    return this.campaigns.launch(id);
  }
}
