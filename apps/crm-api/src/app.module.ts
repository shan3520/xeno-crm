import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ZodValidationPipe } from "nestjs-zod";

import { AppController } from "./app.controller";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { AppLogger } from "./common/app-logger.service";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AppConfigModule } from "./config/config.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { ChatModule } from "./chat/chat.module";
import { CustomersModule } from "./customers/customers.module";
import { IngestModule } from "./ingest/ingest.module";
import { OrdersModule } from "./orders/orders.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReceiptsModule } from "./receipts/receipts.module";
import { SegmentsModule } from "./segments/segments.module";
import { SendWorkerModule } from "./send-worker/send-worker.module";

/**
 * Application spine. Domain modules (ingest, segments, campaigns, worker, receipts,
 * analytics) plug in here later — this wires only cross-cutting concerns:
 * config + Prisma + global Zod validation + structured logging + error envelope.
 */
@Module({
  imports: [
    // Per-IP rate limit (generous default so normal use + polling is never throttled; tune via
    // RATE_LIMIT_TTL_MS / RATE_LIMIT_MAX). /health and /receipts opt out via @SkipThrottle so the
    // keepalive cron and the channel-stub's callback burst are never blocked.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS) || 60_000,
        limit: Number(process.env.RATE_LIMIT_MAX) || 200,
      },
    ]),
    AppConfigModule,
    PrismaModule,
    CustomersModule,
    OrdersModule,
    IngestModule,
    SegmentsModule,
    CampaignsModule,
    SendWorkerModule,
    ReceiptsModule,
    AnalyticsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppLogger,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
  exports: [AppLogger],
})
export class AppModule {}
