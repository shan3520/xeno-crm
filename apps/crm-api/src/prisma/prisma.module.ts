import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service";

/**
 * Global Prisma module. Every domain module (ingest, segments, campaigns, worker,
 * receipts, analytics) injects PrismaService without re-importing this.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
