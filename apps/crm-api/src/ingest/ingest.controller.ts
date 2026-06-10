import { Body, Controller, HttpCode, Post } from "@nestjs/common";

import {
  IngestCustomersDto,
  IngestOrdersDto,
  type IngestCustomersResult,
  type IngestOrdersResult,
} from "./ingest.dto";
import { IngestService } from "./ingest.service";

@Controller("ingest")
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /** POST /ingest/customers — bulk upsert by externalId. Returns { created, updated }. */
  @Post("customers")
  @HttpCode(200)
  ingestCustomers(@Body() dto: IngestCustomersDto): Promise<IngestCustomersResult> {
    return this.ingest.ingestCustomers(dto);
  }

  /**
   * POST /ingest/orders — bulk upsert orders + items, then recompute touched customers'
   * stats. Returns { created, updated, customersTouched }.
   */
  @Post("orders")
  @HttpCode(200)
  ingestOrders(@Body() dto: IngestOrdersDto): Promise<IngestOrdersResult> {
    return this.ingest.ingestOrders(dto);
  }
}
