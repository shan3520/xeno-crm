import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { ReconcileService } from "./reconcile.service";

/**
 * Drives the reconciliation sweep as an in-process fixed-interval loop: run a pass, sleep
 * RECONCILE_INTERVAL_MS, repeat. Starts on module init and stops cleanly on shutdown — no
 * orphaned timers, no overlapping passes (the next sleep only begins after a pass settles).
 *
 * Auto-start is suppressed for tests (NODE_ENV=test) and for the one-shot reconcile entry
 * (RECONCILE_DISABLE_AUTOSTART=1), which drive `reconcileOnce()` deterministically themselves.
 */
@Injectable()
export class ReconcileRunner implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcileRunner.name);
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly reconcile: ReconcileService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.RECONCILE_DISABLE_AUTOSTART === "1"
    ) {
      this.logger.log("Reconcile sweep auto-start suppressed");
      return;
    }
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log(
      `Reconcile sweep started (every ${this.config.reconcileIntervalMs}ms)`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.running && !this.loopPromise) return;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.(); // break an in-progress sleep immediately
    await this.loopPromise?.catch(() => undefined);
    this.logger.log("Reconcile sweep stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.reconcile.reconcileOnce();
        if (result.commsHealed > 0 || result.campaignsCompleted > 0) {
          this.logger.log(
            `sweep: checked=${result.campaignsChecked} healed=${result.commsHealed} completed=${result.campaignsCompleted}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Reconcile pass failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await this.sleep();
    }
  }

  /** Interruptible sleep — resolves early when the loop is told to stop. */
  private sleep(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = () => {
        if (this.timer) clearTimeout(this.timer);
        this.wake = undefined;
        resolve();
      };
      this.timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, this.config.reconcileIntervalMs);
    });
  }
}
