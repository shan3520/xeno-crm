import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppLogger } from "./common/app-logger.service";
import { requestIdMiddleware } from "./common/request-id.middleware";
import { AppConfigService } from "./config/app-config.service";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // rawBody: true exposes req.rawBody (the exact received bytes) so the receipt-signature guard
  // can verify the channel-stub's HMAC over the same payload the stub signed.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  // Swap in the structured logger before anything else logs.
  app.useLogger(app.get(AppLogger));

  // Request-id context must wrap the request pipeline, so register before routes run.
  app.use(requestIdMiddleware);

  const config = app.get(AppConfigService);
  app.enableCors({ origin: config.webOrigin, credentials: true });

  // Don't advertise the framework/version to clients (defense in depth, info disclosure).
  const httpInstance = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (setting: string, value: unknown) => void;
  };
  httpInstance.disable?.("x-powered-by");
  // Behind Render's proxy, honor X-Forwarded-For so the rate-limiter keys on the real client IP
  // (otherwise every request looks like the proxy's IP and shares one bucket → real users get 429s).
  httpInstance.set?.("trust proxy", 1);

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
