import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Query params for GET /orders. Numerics coerced from strings; customerId optional. */
export const OrderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  customerId: z.string().min(1).optional(),
});
export type OrderListQuery = z.infer<typeof OrderListQuerySchema>;

export class OrderListQueryDto extends createZodDto(OrderListQuerySchema) {}
