import { Module } from "@nestjs/common";

import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { CustomerStatsService } from "./stats.service";
import { WorkspaceResolver } from "./workspace.resolver";

/**
 * Foundation module for the data-in layer. Owns the customer reads plus the two pieces
 * the orders/ingest modules build on: the single-workspace resolver and the denormalized
 * stats recompute. Both are exported for those modules to inject.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerStatsService, WorkspaceResolver],
  exports: [CustomerStatsService, WorkspaceResolver],
})
export class CustomersModule {}
