import "reflect-metadata";

import { ConfigService } from "@nestjs/config";

import { AppConfigService } from "../config/app-config.service";
import { validateEnv } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { SendWorkerService } from "./send-worker.service";

/**
 * `pnpm worker:once` — run exactly one claim+process pass and exit. Used for
 * debugging/tests; deterministic (no loop, no timers, no auto-started Runner).
 *
 * We wire the worker directly from validated env rather than booting the Nest container:
 * this entry runs under tsx (esbuild), which does not emit the decorator metadata Nest's
 * constructor injection relies on. Direct construction keeps the single pass fast and
 * reflection-free while reusing the real AppConfigService + env validation.
 */
async function main(): Promise<void> {
  const env = validateEnv(process.env as Record<string, unknown>);
  const config = new AppConfigService(new ConfigService(env));
  const prisma = new PrismaService();
  const worker = new SendWorkerService(prisma, config);

  try {
    const result = await worker.runOnce();
    console.log(`worker:once → ${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
