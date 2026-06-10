import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Query params for GET /customers. Values arrive as strings, so numerics are coerced.
 * Filters are all optional and combine with AND. Recency is expressed in "days ago"
 * relative to now: lastOrderBeforeDays => lapsed at least N days; lastOrderAfterDays =>
 * ordered within the last N days.
 */
export const CustomerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  email: z.string().min(1).optional(),
  tier: z.string().min(1).optional(),
  lastOrderBeforeDays: z.coerce.number().int().nonnegative().optional(),
  lastOrderAfterDays: z.coerce.number().int().nonnegative().optional(),
  minSpend: z.coerce.number().nonnegative().optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

export class CustomerListQueryDto extends createZodDto(CustomerListQuerySchema) {}
