import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";

import { SendWorkerService } from "./send-worker.service";

/** How long an idle worker waits before polling again (so it doesn't hammer Neon). */
const IDLE_POLL_MS = 1_000;

/**
 * Drives the worker as an in-process adaptive-poll loop: when a pass claims rows it loops
 * again immediately (drain fast); when a pass finds nothing it sleeps IDLE_POLL_MS before
 * polling again. Starts on module init and stops cleanly on application shutdown — no
 * orphaned timers, no overlapping passes.
 *
 * Auto-start is suppressed for tests (NODE_ENV=test) and for `worker:once`
 * (WORKER_DISABLE_AUTOSTART=1) so those drive `runOnce()` deterministically themselves.
 */
@Injectable()
export class SendWorkerRunner implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SendWorkerRunner.name);
  private running = false;
  private loopPromise: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly worker: SendWorkerService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.WORKER_DISABLE_AUTOSTART === "1") {
      this.logger.log("Send worker auto-start suppressed");
      return;
    }
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log(`Send worker loop started (${this.worker.instanceId})`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.running && !this.loopPromise) return;
    this.running = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.wake?.(); // break an in-progress idle sleep immediately
    await this.loopPromise?.catch(() => undefined);
    this.logger.log("Send worker loop stopped");
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.worker.runOnce();
        // Drain fast while there's work; back off to the idle poll when empty.
        if (result.claimed === 0) {
          await this.idleSleep();
        }
      } catch (err) {
        this.logger.error(
          `Worker pass failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.idleSleep();
      }
    }
  }

  /** Interruptible idle sleep — resolves early when the loop is told to stop. */
  private idleSleep(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = () => {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.wake = undefined;
        resolve();
      };
      this.idleTimer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, IDLE_POLL_MS);
    });
  }
}
