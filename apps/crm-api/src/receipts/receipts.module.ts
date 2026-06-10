import { Module } from "@nestjs/common";

import { ReceiptsController } from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";

/**
 * Receipts: ingest channel-stub lifecycle callbacks as append-only CommunicationEvents and
 * project Communication.status from the event set. Talks only to the shared Communication /
 * Campaign / Order tables (Prisma is global) — no worker or campaign-service internals.
 */
@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
