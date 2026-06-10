import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "./env.validation";

/**
 * Strongly-typed accessor over the validated config. Wraps ConfigService so the rest of
 * the app never touches raw `process.env` or stringly-typed lookups.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config.get(key, { infer: true });
  }

  get databaseUrl(): string {
    return this.get("DATABASE_URL");
  }

  get channelStubUrl(): string {
    return this.get("CHANNEL_STUB_URL");
  }

  get publicBaseUrl(): string {
    return this.get("PUBLIC_BASE_URL");
  }

  get workerConcurrency(): number {
    return this.get("WORKER_CONCURRENCY");
  }

  get workerMaxAttempts(): number {
    return this.get("WORKER_MAX_ATTEMPTS");
  }

  get sendRatePerSec(): number {
    return this.get("SEND_RATE_PER_SEC");
  }

  get reconcileIntervalMs(): number {
    return this.get("RECONCILE_INTERVAL_MS");
  }

  get webOrigin(): string {
    return this.get("WEB_ORIGIN");
  }

  get port(): number {
    return this.get("PORT");
  }

  get nodeEnv(): AppConfig["NODE_ENV"] {
    return this.get("NODE_ENV");
  }
}
