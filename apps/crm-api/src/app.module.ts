import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

import { AppController } from "./app.controller";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { AppLogger } from "./common/app-logger.service";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AppConfigModule } from "./config/config.module";
import { CustomersModule } from "./customers/customers.module";
import { IngestModule } from "./ingest/ingest.module";
import { OrdersModule } from "./orders/orders.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SegmentsModule } from "./segments/segments.module";

/**
 * Application spine. Domain modules (ingest, segments, campaigns, worker, receipts,
 * analytics) plug in here later — this wires only cross-cutting concerns:
 * config + Prisma + global Zod validation + structured logging + error envelope.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CustomersModule,
    OrdersModule,
    IngestModule,
    SegmentsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppLogger,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
  exports: [AppLogger],
})
export class AppModule {}
