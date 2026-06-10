import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

/**
 * Data-in writes. Depends on CustomersModule for the workspace resolver and the
 * denormalized stats recompute used after order ingest.
 */
@Module({
  imports: [CustomersModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
