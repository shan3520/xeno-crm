import { CustomerIngestSchema, OrderIngestSchema } from "@xeno/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Request bodies for the bulk ingest endpoints. The element shapes come straight from
 * @xeno/shared (the frozen contract) — we only wrap them in the `{ customers }` /
 * `{ orders }` envelopes the endpoints accept.
 */

export const IngestCustomersBodySchema = z.object({
  customers: z.array(CustomerIngestSchema).min(1),
});
export class IngestCustomersDto extends createZodDto(IngestCustomersBodySchema) {}

export const IngestOrdersBodySchema = z.object({
  orders: z.array(OrderIngestSchema).min(1),
});
export class IngestOrdersDto extends createZodDto(IngestOrdersBodySchema) {}

export interface IngestCustomersResult {
  created: number;
  updated: number;
}

export interface IngestOrdersResult {
  created: number;
  updated: number;
  customersTouched: number;
}
