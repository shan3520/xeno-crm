import { Module } from "@nestjs/common";

import { ReceiptsController } from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";
import { ReconcileRunner } from "./reconcile.runner";
import { ReconcileService } from "./reconcile.service";

/**
 * Receipts: ingest channel-stub lifecycle callbacks as append-only CommunicationEvents and
 * project Communication.status from the event set. Talks only to the shared Communication /
 * Campaign / Order tables (Prisma is global) — no worker or campaign-service internals.
 *
 * ReconcileService + ReconcileRunner add a periodic completion/self-heal sweep (defense in
 * depth around the projection); ReconcileService is exported for the one-shot reconcile entry.
 */
@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReconcileService, ReconcileRunner],
  exports: [ReconcileService],
})
export class ReceiptsModule {}
