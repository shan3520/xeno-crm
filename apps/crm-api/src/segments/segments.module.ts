import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module";
import { SegmentsController } from "./segments.controller";
import { SegmentsService } from "./segments.service";

/**
 * Segments: compile the AI's DSL into a real Customer audience. Depends on CustomersModule
 * for the single-workspace resolver (and reuses its JSON-safe customer mapper).
 */
@Module({
  imports: [CustomersModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
