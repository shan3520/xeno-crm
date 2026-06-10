import { Module } from "@nestjs/common";

import { SendWorkerRunner } from "./send-worker.runner";
import { SendWorkerService } from "./send-worker.service";

/**
 * Send-queue worker: drains QUEUED Communications to SENT/FAILED via the channel stub.
 * SendWorkerService is the pass logic (also used by `worker:once` and tests); the Runner
 * owns the auto-started in-process loop. Prisma + config come from their global modules.
 */
@Module({
  providers: [SendWorkerService, SendWorkerRunner],
  exports: [SendWorkerService],
})
export class SendWorkerModule {}
