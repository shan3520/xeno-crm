import { z } from "zod";

import { ChannelSchema, CommEventTypeSchema } from "./enums";
import { SegmentDefinitionSchema } from "./segment";

/**
 * Ingest + write DTOs. Money/amount fields are plain numbers here (Prisma Decimal is a DB
 * concern); timestamps are ISO datetime strings. No DB or framework imports.
 */

// ---- Customer ingest ----

/** Optional precomputed order rollups, supplied by the seed/import to avoid recomputation. */
export const CustomerOrderStatsSchema = z.object({
  totalSpend: z.number().nonnegative(),
  orderCount: z.number().int().nonnegative(),
  firstOrderAt: z.string().datetime({ offset: true }).nullable().optional(),
  lastOrderAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CustomerOrderStats = z.infer<typeof CustomerOrderStatsSchema>;

export const CustomerIngestSchema = z.object({
  externalId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  // Free-form attributes (e.g. city, tier, tags) the segment compiler may read.
  attributes: z.record(z.string(), z.unknown()).default({}),
  orderStats: CustomerOrderStatsSchema.optional(),
});
export type CustomerIngest = z.infer<typeof CustomerIngestSchema>;

// ---- Order ingest ----

export const OrderItemSchema = z.object({
  productName: z.string().min(1),
  sku: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderIngestSchema = z.object({
  externalId: z.string().min(1),
  customerExternalId: z.string().min(1),
  totalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  status: z.string().min(1),
  orderedAt: z.string().datetime({ offset: true }),
  items: z.array(OrderItemSchema).min(1),
});
export type OrderIngest = z.infer<typeof OrderIngestSchema>;

// ---- Campaign draft ----

export const CampaignDraftSchema = z
  .object({
    name: z.string().min(1),
    goal: z.string().min(1),
    // Either reference a saved segment or carry an inline definition (at least one).
    segmentId: z.string().min(1).optional(),
    definition: SegmentDefinitionSchema.optional(),
    channel: ChannelSchema,
    // May contain {{token}} placeholders, rendered per-recipient by crm-api at send time.
    messageTemplate: z.string().min(1),
  })
  .refine((d) => d.segmentId !== undefined || d.definition !== undefined, {
    message: "Provide either segmentId or an inline segment definition.",
    path: ["segmentId"],
  });
export type CampaignDraft = z.infer<typeof CampaignDraftSchema>;

// ---- Receipt event (channel stub -> crm-api) ----

export const ReceiptEventSchema = z.object({
  communicationId: z.string().min(1),
  providerMessageId: z.string().min(1),
  type: CommEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  // Idempotency: receipts must be deduplicated on this key by crm-api.
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ReceiptEvent = z.infer<typeof ReceiptEventSchema>;
