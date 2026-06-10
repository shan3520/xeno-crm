import { CampaignDraftSchema } from "@xeno/shared";
import { createZodDto } from "nestjs-zod";

/**
 * Create-campaign body. Shape comes from the frozen @xeno/shared CampaignDraftSchema, whose
 * refine guarantees at least one audience source (segmentId or inline definition).
 */
export class CampaignCreateDto extends createZodDto(CampaignDraftSchema) {}
