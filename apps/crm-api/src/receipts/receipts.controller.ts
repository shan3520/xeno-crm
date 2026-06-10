import { Body, Controller, HttpCode, Post } from "@nestjs/common";

import { ReceiptDto, type ReceiptResult } from "./receipts.dto";
import { ReceiptsService } from "./receipts.service";

@Controller("receipts")
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /**
   * POST /receipts — ingest a channel-stub lifecycle callback (delivered/opened/read/
   * clicked/failed/converted). Idempotent on idempotencyKey; always returns 200 (a duplicate
   * is a successful no-op). Callback-ingest only — never sends or calls the stub.
   */
  @Post()
  @HttpCode(200)
  ingest(@Body() dto: ReceiptDto): Promise<ReceiptResult> {
    return this.receipts.ingest(dto);
  }
}
