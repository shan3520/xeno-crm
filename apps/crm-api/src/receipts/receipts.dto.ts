import { ReceiptEventSchema } from "@xeno/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** POST /receipts body — the channel stub's lifecycle callback (from @xeno/shared). */
export class ReceiptDto extends createZodDto(ReceiptEventSchema) {}

/**
 * Conversion payload carried by a CONVERTED receipt. Validated leniently — a malformed
 * payload still counts the conversion but cannot attribute revenue.
 */
export const ConversionPayloadSchema = z.object({
  externalId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  orderedAt: z.string().datetime({ offset: true }).optional(),
});
export type ConversionPayload = z.infer<typeof ConversionPayloadSchema>;

export interface ReceiptResult {
  ok: true;
  duplicate: boolean;
  status?: string;
}
