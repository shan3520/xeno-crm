import { SegmentDefinitionSchema, SegmentOriginSchema } from "@xeno/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Request DTOs for the segments endpoints. The `definition` shape comes straight from the
 * frozen @xeno/shared DSL; the compiler enforces the field/operator whitelist downstream.
 */

export const SegmentPreviewBodySchema = z.object({
  definition: SegmentDefinitionSchema,
});
export class SegmentPreviewDto extends createZodDto(SegmentPreviewBodySchema) {}

export const SegmentCreateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  definition: SegmentDefinitionSchema,
  origin: SegmentOriginSchema.default("AI"),
});
export class SegmentCreateDto extends createZodDto(SegmentCreateBodySchema) {}

/** Pagination for GET /segments/:id/members. */
export const SegmentMembersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type SegmentMembersQuery = z.infer<typeof SegmentMembersQuerySchema>;
export class SegmentMembersQueryDto extends createZodDto(SegmentMembersQuerySchema) {}
