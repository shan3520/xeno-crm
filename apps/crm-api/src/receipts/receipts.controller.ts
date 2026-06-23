import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

import { ReceiptDto, type ReceiptResult } from "./receipts.dto";
import { ReceiptSignatureGuard } from "./receipt-signature.guard";
import { ReceiptsService } from "./receipts.service";

// Callbacks arrive in bursts from the channel-stub (one IP) during a send — never rate-limit them;
// they're authenticated by HMAC signature instead (see ReceiptSignatureGuard).
@SkipThrottle()
@UseGuards(ReceiptSignatureGuard)
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
