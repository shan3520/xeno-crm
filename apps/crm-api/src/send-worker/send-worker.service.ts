import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../prisma/prisma.service";
import { backoffDelayMs, LEASE_MS } from "./backoff";
import { isTransientStatus } from "./failure-classification";

/** Per-send HTTP ceiling. Must stay well under LEASE_MS so a send finishes inside its lease. */
const SEND_TIMEOUT_MS = 10_000;

/** Result of a single claim+process pass. */
export interface WorkerPassResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

/** Minimal comm shape the processor needs (snapshot fields are already frozen). */
interface ClaimedComm {
  id: string;
  campaignId: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "RCS";
  recipientAddress: string;
  renderedMessage: string;
  attemptCount: number;
}

type SendOutcome =
  | { ok: true; providerMessageId: string }
  /**
   * `retryable` marks a TRANSIENT infrastructure failure (stub cold-start 429/5xx, network,
   * timeout) vs a PERMANENT one (4xx, contract violation). Transient failures must not consume
   * the dead-letter budget — see markFailure.
   */
  | { ok: false; reason: string; retryable: boolean };

/**
 * The send-queue worker core. The Communication row is the work item: this claims QUEUED
 * rows via a real FOR UPDATE SKIP LOCKED transaction, POSTs each to the channel stub's
 * /send, and drives the claim lifecycle (lease → SENT, or retry-with-backoff, or
 * dead-letter to FAILED). It NEVER processes callbacks or writes CommunicationEvents —
 * that is the receipts handler. `runOnce()` is a single deterministic pass (used by the
 * auto-loop, by `worker:once`, and by tests); it contains no infinite loop or timers.
 */
@Injectable()
export class SendWorkerService {
  private readonly logger = new Logger(SendWorkerService.name);
  /** Identifies this worker instance in lockedBy, for debugging/observability. */
  readonly instanceId = `crm-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  /** Timestamp of the last send, for simple SEND_RATE_PER_SEC spacing. */
  private lastSendAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  // ─── One pass ─────────────────────────────────────────────────────

  async runOnce(): Promise<WorkerPassResult> {
    const ids = await this.claim();
    if (ids.length === 0) {
      return { claimed: 0, sent: 0, retried: 0, failed: 0 };
    }

    const comms = (await this.prisma.communication.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        campaignId: true,
        channel: true,
        recipientAddress: true,
        renderedMessage: true,
        attemptCount: true,
      },
    })) as ClaimedComm[];

    // Simple rate limiting: space sends by 1000/SEND_RATE_PER_SEC ms (per worker instance).
    const spacingMs = Math.max(0, Math.floor(1000 / this.config.sendRatePerSec));

    let sent = 0;
    let retried = 0;
    let failed = 0;

    for (const comm of comms) {
      await this.respectRate(spacingMs);
      const outcome = await this.callStub(comm);

      if (outcome.ok) {
        if (await this.markSent(comm, outcome.providerMessageId)) sent++;
      } else {
        const result = await this.markFailure(comm, outcome.reason, outcome.retryable);
        if (result === "retry") retried++;
        else if (result === "dead") failed++;
      }
    }

    return { claimed: ids.length, sent, retried, failed };
  }

  // ─── 1. CLAIM (FOR UPDATE SKIP LOCKED) ────────────────────────────

  /**
   * Claim up to WORKER_CONCURRENCY claimable comms in ONE transaction, leasing each so a
   * concurrent worker's SKIP LOCKED scan never grabs the same row. Raw SQL for the select
   * only (Prisma can't express FOR UPDATE SKIP LOCKED); identifiers are double-quoted
   * (PascalCase table, camelCase columns) and every value is parameterized — no string
   * interpolation. The status guard (`status = 'QUEUED'`) is what makes an already
   * SENT/FAILED comm un-claimable (idempotency at the source).
   */
  private async claim(): Promise<string[]> {
    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - LEASE_MS);
    const limit = this.config.workerConcurrency;

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Communication"
        WHERE "status" = 'QUEUED'
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND ("lockedAt" IS NULL OR "lockedAt" < ${leaseCutoff})
        ORDER BY "nextAttemptAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;

      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await tx.communication.updateMany({
          where: { id: { in: ids } },
          data: { lockedAt: now, lockedBy: this.instanceId },
        });
      }
      return ids;
    });
  }

  // ─── 2. PROCESS ───────────────────────────────────────────────────

  private async callStub(comm: ClaimedComm): Promise<SendOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.channelStubUrl}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          communicationId: comm.id,
          channel: comm.channel,
          recipientAddress: comm.recipientAddress,
          renderedMessage: comm.renderedMessage,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // 429 (throttle) and 5xx (incl. Render cold-start 502/503/504) are transient — the
        // stub is waking or overloaded, not refusing the request. Retry without burning the
        // dead-letter budget. Other 4xx (bad request, etc.) are permanent.
        return {
          ok: false,
          reason: `channel-stub responded ${res.status}`,
          retryable: isTransientStatus(res.status),
        };
      }
      const body = (await res.json()) as { providerMessageId?: unknown };
      if (typeof body.providerMessageId !== "string" || body.providerMessageId.length === 0) {
        // A 2xx with no id is a contract violation, not a transient blip — don't loop forever.
        return { ok: false, reason: "channel-stub response missing providerMessageId", retryable: false };
      }
      return { ok: true, providerMessageId: body.providerMessageId };
    } catch (err) {
      // Network failure / DNS / connection refused / AbortController timeout — all transient
      // (the stub is unreachable or slow to wake), so retry rather than dead-letter.
      const reason = err instanceof Error ? err.message : "unknown send error";
      return { ok: false, reason: `send failed: ${reason}`, retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Mark a comm SENT and bump the campaign's sentCount — atomically and idempotently. The
   * `status = 'QUEUED'` guard means a comm that somehow already advanced is a no-op (count
   * 0), so we never double-send or double-count. sentCount is the projection cache the
   * receipts handler also maintains.
   */
  private async markSent(comm: ClaimedComm, providerMessageId: string): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.communication.updateMany({
        where: { id: comm.id, status: "QUEUED" },
        data: {
          status: "SENT",
          sentAt: now,
          providerMessageId,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (upd.count !== 1) return false; // already past QUEUED — idempotent no-op
      await tx.campaign.update({
        where: { id: comm.campaignId },
        data: { sentCount: { increment: 1 } },
      });
      return true;
    });
  }

  /**
   * Handle a send failure: retry-with-backoff while attempts remain, else dead-letter.
   * Returns 'retry' | 'dead' | 'noop'. All updates are guarded on status = 'QUEUED' so a
   * concurrently-resolved comm is left untouched.
   *
   * `retryable` (transient infra: stub cold-start 429/5xx, network, timeout) does NOT consume
   * the dead-letter budget: such a comm always retries with capped exponential backoff and
   * never moves to FAILED. This is the fix for a cold channel-stub dead-lettering a whole
   * batch — the worker's short backoff (~1+2+4+8s) is otherwise spent before a ~50s Render
   * cold start finishes, so all WORKER_MAX_ATTEMPTS are burned on 429/503 and the batch dies.
   * attemptCount still increments for observability; the backoff cap (MAX_BACKOFF_MS) bounds
   * the retry rate while the stub is down. Only PERMANENT failures (4xx, contract violations)
   * count toward workerMaxAttempts and dead-letter.
   */
  private async markFailure(
    comm: ClaimedComm,
    reason: string,
    retryable: boolean,
  ): Promise<"retry" | "dead" | "noop"> {
    const now = new Date();
    const attemptCount = comm.attemptCount + 1;

    if (retryable || attemptCount < this.config.workerMaxAttempts) {
      const nextAttemptAt = new Date(now.getTime() + backoffDelayMs(attemptCount));
      const upd = await this.prisma.communication.updateMany({
        where: { id: comm.id, status: "QUEUED" },
        data: {
          attemptCount,
          nextAttemptAt,
          failureReason: reason.slice(0, 500),
          lockedAt: null, // release the lease so it's reclaimable after nextAttemptAt
          lockedBy: null,
        },
      });
      return upd.count === 1 ? "retry" : "noop";
    }

    // Max attempts reached — dead-letter.
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.communication.updateMany({
        where: { id: comm.id, status: "QUEUED" },
        data: {
          status: "FAILED",
          failedAt: now,
          failureReason: reason.slice(0, 500),
          attemptCount,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (upd.count !== 1) return "noop";
      await tx.campaign.update({
        where: { id: comm.campaignId },
        data: { failedCount: { increment: 1 } },
      });
      return "dead";
    });
  }

  // ─── Rate limiting ────────────────────────────────────────────────

  /** Sleep just enough to keep sends spaced at ~1000/SEND_RATE_PER_SEC ms apart. */
  private async respectRate(spacingMs: number): Promise<void> {
    if (spacingMs <= 0) return;
    const elapsed = Date.now() - this.lastSendAt;
    if (elapsed < spacingMs) {
      await new Promise((resolve) => setTimeout(resolve, spacingMs - elapsed));
    }
    this.lastSendAt = Date.now();
  }
}
