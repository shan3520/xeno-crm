import "reflect-metadata";

import { PrismaService } from "../prisma/prisma.service";
import { ReconcileService } from "./reconcile.service";

/**
 * `pnpm reconcile` — run exactly one reconciliation sweep and exit. Heals any comm whose
 * status drifted behind its events and completes any SENDING campaign with nothing in-flight.
 * Idempotent and safe to re-run.
 *
 * Wired directly from Prisma (no Nest container) for the same reason as `worker:once`: this
 * runs under tsx, which doesn't emit the decorator metadata Nest's DI relies on. The
 * auto-started Runner never boots here, so the pass is deterministic.
 */
async function main(): Promise<void> {
  const prisma = new PrismaService();
  const reconcile = new ReconcileService(prisma);

  try {
    const result = await reconcile.reconcileOnce();
    console.log(`reconcile:once → ${JSON.stringify(result)}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
