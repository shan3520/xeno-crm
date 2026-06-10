import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppLogger } from "./common/app-logger.service";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { AppConfigService } from "./config/app-config.service";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Swap in the structured logger before anything else logs.
  app.useLogger(app.get(AppLogger));

  // Request-id context must wrap the request pipeline, so register before routes run.
  app.use(requestIdMiddleware);

  const config = app.get(AppConfigService);
  app.enableCors({ origin: config.webOrigin, credentials: true });

  // Fire OnApplicationShutdown hooks on SIGINT/SIGTERM so the send-worker loop (and Prisma)
  // shut down cleanly — no orphaned timers, no half-open pool.
  app.enableShutdownHooks();

  await app.listen(config.port);
  app
    .get(AppLogger)
    .log(
      `crm-api listening on http://localhost:${config.port} (web origin: ${config.webOrigin})`,
      "Bootstrap",
    );
}

void bootstrap().catch((err: unknown) => {
  // Boot failed (e.g. invalid/missing env) — print the clear message and exit non-zero.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
