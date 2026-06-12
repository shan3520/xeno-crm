import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CommStatus } from "@xeno/shared";

import { PrismaService } from "../prisma/prisma.service";
import { projectCommunication, type ProjectionEvent } from "./projection";
import { isBehind, projectionToCommunicationUpdate } from "./projection-apply";

/** Outcome of one full reconciliation pass. */
export interface ReconcileSummary {
  campaignsChecked: number;
  commsHealed: number;
  commsExpired: number;
  campaignsCompleted: number;
}

/** Per-campaign reconciliation result. */
export interface CampaignReconcileResult {
  healed: number;
  expired: number;
  completed: boolean;
}

/**
 * How long a SENT comm may wait for its first lifecycle receipt before the sweep declares the
 * callbacks lost and expires it as FAILED. The stub fires callbacks on in-memory timers within
 * MAX_DELAY_MS (default 30s, plus duplicate jitter) — so 10 minutes is a ~20× safety margin.
 * A stub restart drops its pending timers; without this timeout those comms would sit at SENT
 * forever and pin their campaign in SENDING. A constant (like the worker's LEASE_MS), not env:
 * it only needs to be "much longer than any legitimate callback delay".
 */
export const RECEIPT_TIMEOUT_MS = 10 * 60_000;

/** failureReason / event payload reason stamped on an expired comm. */
const EXPIRE_REASON = "no lifecycle receipt within timeout — channel callbacks assumed lost";

/**
 * SQL precedence rank, kept in lockstep with STATUS_RANK in projection-apply.ts. Used inside
 * the drift-detection query to find comms whose stored status is BEHIND the status implied by
 * their events. FAILED is terminal-dominant (it outranks the whole ladder), matching the pure
 * projector; CONVERTED is a side-flag and contributes 0 so it never affects status.
 */
const EVENT_RANK_SQL = Prisma.sql`CASE e."type"
  WHEN 'FAILED' THEN 100
  WHEN 'CLICKED' THEN 5
  WHEN 'READ' THEN 4
  WHEN 'OPENED' THEN 3
  WHEN 'DELIVERED' THEN 2
  WHEN 'SENT' THEN 1
  ELSE 0 END`;

const STATUS_RANK_SQL = Prisma.sql`CASE c."status"
  WHEN 'FAILED' THEN 100
  WHEN 'CLICKED' THEN 5
  WHEN 'READ' THEN 4
  WHEN 'OPENED' THEN 3
  WHEN 'DELIVERED' THEN 2
  WHEN 'SENT' THEN 1
  WHEN 'QUEUED' THEN 0
  ELSE 0 END`;

/**
 * Reconciliation / completion sweep — defense-in-depth around the receipt projection.
 *
 * Three failure modes it heals:
 *  1. A status that drifted BEHIND its events (the lost-update race FIX 1 closes; this catches
 *     any row written before the fix, or by a path we don't control). The append-only event
 *     log is the source of truth: we re-project from it and advance the stored status — never
 *     downgrade.
 *  2. A comm stuck at SENT because the stub's in-memory callbacks were lost (stub restart,
 *     dropped POSTs). After RECEIPT_TIMEOUT_MS with no receipt we APPEND a synthetic FAILED
 *     event (the event log stays the source of truth — status is still a projection) and
 *     re-project, so the comm terminates instead of pinning its campaign in SENDING forever.
 *  3. A SENDING campaign that can't complete because a comm is stuck in-flight. Once no comm
 *     remains QUEUED/SENT (so no further receipt will move a counter), we recompute the
 *     receipt-owned counters authoritatively from the event sets and flip to COMPLETED — so a
 *     dropped stub callback can't hang a campaign forever.
 *
 * Pure projection rules are unchanged; this only re-applies them and recomputes denormalized
 * counters to converge on the same values the per-event path would have produced.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** One pass over every SENDING campaign. Safe to run repeatedly; fully idempotent. */
  async reconcileOnce(): Promise<ReconcileSummary> {
    const sending = await this.prisma.campaign.findMany({
      where: { status: "SENDING" },
      select: { id: true },
    });

    let commsHealed = 0;
    let commsExpired = 0;
    let campaignsCompleted = 0;
    for (const { id } of sending) {
      const result = await this.reconcileCampaign(id);
      commsHealed += result.healed;
      commsExpired += result.expired;
      if (result.completed) campaignsCompleted++;
    }
    return {
      campaignsChecked: sending.length,
      commsHealed,
      commsExpired,
      campaignsCompleted,
    };
  }

  /**
   * Heal any drifted comms in one campaign, expire any SENT comm whose receipts are overdue,
   * then complete the campaign if nothing is left in-flight. Heal runs FIRST so a comm whose
   * events already advanced it past SENT is never considered for expiry.
   */
  async reconcileCampaign(campaignId: string): Promise<CampaignReconcileResult> {
    const drifted = await this.findDriftedCommIds(campaignId);
    let healed = 0;
    for (const id of drifted) {
      if (await this.healComm(id)) healed++;
    }

    const expired = await this.expireStaleSends(campaignId);

    const completed = await this.finalizeIfComplete(campaignId);
    if (healed > 0 || expired > 0 || completed) {
      this.logger.log(
        `reconcile ${campaignId}: healed=${healed} expired=${expired} completed=${completed}`,
      );
    }
    return { healed, expired, completed };
  }

  /**
   * Comms whose stored status is strictly behind the status implied by their events — found in
   * ONE set-based query (no per-comm event reads) so a quiet campaign costs a single round
   * trip. The result is almost always empty once FIX 1 is in place.
   */
  private async findDriftedCommIds(campaignId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT e."communicationId" AS id
      FROM "CommunicationEvent" e
      JOIN "Communication" c ON c."id" = e."communicationId"
      WHERE c."campaignId" = ${campaignId}
      GROUP BY e."communicationId", c."status"
      HAVING MAX(${EVENT_RANK_SQL}) > (${STATUS_RANK_SQL})
    `);
    return rows.map((r) => r.id);
  }

  /**
   * Re-project ONE comm from its full event set under a row lock and advance its status if the
   * events imply a later one. Never downgrades (isBehind guard). Mirrors the live handler's
   * serialization so it can't race a concurrent receipt for the same comm.
   */
  private async healComm(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Communication" WHERE "id" = ${id} FOR UPDATE`;

      const comm = await tx.communication.findUnique({
        where: { id },
        select: { status: true, failureReason: true },
      });
      if (!comm) return false;

      const events = (await tx.communicationEvent.findMany({
        where: { communicationId: id },
        select: { type: true, occurredAt: true, payload: true },
      })) as Array<ProjectionEvent & { payload: Prisma.JsonValue }>;

      const projection = projectCommunication(events);
      if (!isBehind(comm.status as CommStatus, projection.status)) {
        return false; // already at/ahead of the events — leave it (never downgrade)
      }

      const failureReason =
        comm.failureReason ?? failureReasonFromEvents(events) ?? undefined;
      await tx.communication.update({
        where: { id },
        data: projectionToCommunicationUpdate(projection, { failureReason }),
      });
      return true;
    });
  }

  /**
   * Expire every SENT comm in the campaign whose sentAt is older than RECEIPT_TIMEOUT_MS and
   * which has received no further receipt. The stub's callbacks ride in-memory timers, so a
   * stub restart silently drops them — without this, such a comm stays SENT forever and the
   * campaign can never flip to COMPLETED. Returns how many comms were expired.
   */
  private async expireStaleSends(campaignId: string): Promise<number> {
    const cutoff = new Date(Date.now() - RECEIPT_TIMEOUT_MS);
    const stale = await this.prisma.communication.findMany({
      where: { campaignId, status: "SENT", sentAt: { lt: cutoff } },
      select: { id: true },
    });

    let expired = 0;
    for (const { id } of stale) {
      if (await this.expireComm(id, campaignId, cutoff)) expired++;
    }
    return expired;
  }

  /**
   * Expire ONE overdue comm by APPENDING a synthetic FAILED event and re-projecting — never by
   * writing status directly, so the event log remains the source of truth. Serialized on the
   * comm row exactly like the live receipt handler: if a real receipt slipped in while we
   * waited for the lock, the re-check sees the comm past SENT and bails. Idempotent via the
   * deterministic idempotencyKey (a second pass inserts nothing). Mirrors the live handler's
   * counter rule: failedCount increments only on the comm's FIRST FAILED event.
   */
  private async expireComm(
    id: string,
    campaignId: string,
    cutoff: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Communication" WHERE "id" = ${id} FOR UPDATE`;

      const comm = await tx.communication.findUnique({
        where: { id },
        select: { status: true, sentAt: true },
      });
      if (!comm || comm.status !== "SENT" || !comm.sentAt || comm.sentAt >= cutoff) {
        return false; // advanced (or re-sent) while we waited — a receipt beat us; leave it
      }

      const inserted = await tx.communicationEvent.createMany({
        data: [
          {
            communicationId: id,
            type: "FAILED",
            occurredAt: new Date(),
            payload: { reason: EXPIRE_REASON, source: "reconcile-expire" },
            idempotencyKey: `reconcile-expire:${id}`,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return false; // already expired by an earlier pass

      const events = (await tx.communicationEvent.findMany({
        where: { communicationId: id },
        select: { type: true, occurredAt: true },
      })) as ProjectionEvent[];
      const projection = projectCommunication(events);
      await tx.communication.update({
        where: { id },
        data: projectionToCommunicationUpdate(projection, { failureReason: EXPIRE_REASON }),
      });

      const failedEvents = events.filter((e) => e.type === "FAILED").length;
      if (failedEvents === 1) {
        await tx.campaign.update({
          where: { id: campaignId },
          data: { failedCount: { increment: 1 } },
        });
      }
      return true;
    });
  }

  /**
   * If the campaign is SENDING and no comm is in-flight (QUEUED/SENT), recompute the
   * receipt-owned funnel counters from the event sets and flip to COMPLETED — all under a
   * campaign-row lock. We only recompute counters at this terminal point, where no further
   * receipt can increment them, so the absolute recompute can't race a concurrent increment.
   * Worker-owned columns (queuedCount, sentCount, audienceSize) are left untouched.
   */
  private async finalizeIfComplete(campaignId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;

      const campaign = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!campaign || campaign.status !== "SENDING") return false;

      const inFlight = await tx.communication.count({
        where: { campaignId, status: { in: ["QUEUED", "SENT"] } },
      });
      if (inFlight > 0) return false;

      await this.recomputeCounters(tx, campaignId);
      await tx.campaign.updateMany({
        where: { id: campaignId, status: "SENDING" },
        data: { status: "COMPLETED" },
      });
      return true;
    });
  }

  /**
   * Recompute the receipt-owned counters as the count of DISTINCT comms with at least one event
   * of each type (exactly what the first-transition-only increments converge to) plus the sum
   * of attributed order revenue. Absolute SET (idempotent), never an increment.
   */
  private async recomputeCounters(
    tx: Prisma.TransactionClient,
    campaignId: string,
  ): Promise<void> {
    const counts = await tx.$queryRaw<{ type: string; n: bigint }[]>(Prisma.sql`
      SELECT e."type" AS type, COUNT(DISTINCT e."communicationId") AS n
      FROM "CommunicationEvent" e
      JOIN "Communication" c ON c."id" = e."communicationId"
      WHERE c."campaignId" = ${campaignId}
      GROUP BY e."type"
    `);
    const revRows = await tx.$queryRaw<{ rev: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT COALESCE(SUM(o."totalAmount"), 0) AS rev
      FROM "Order" o
      JOIN "Communication" c ON c."id" = o."attributedCommunicationId"
      WHERE c."campaignId" = ${campaignId}
    `);

    const n = (type: string): number =>
      Number(counts.find((c) => c.type === type)?.n ?? 0n);

    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        deliveredCount: n("DELIVERED"),
        openedCount: n("OPENED"),
        readCount: n("READ"),
        clickedCount: n("CLICKED"),
        failedCount: n("FAILED"),
        convertedCount: n("CONVERTED"),
        attributedRevenue: revRows[0]?.rev ?? new Prisma.Decimal(0),
      },
    });
  }
}

/** Pull a human reason from a FAILED event's payload, if one is present. */
function failureReasonFromEvents(
  events: Array<{ type: string; payload?: Prisma.JsonValue }>,
): string | undefined {
  const failed = events.find((e) => e.type === "FAILED");
  const payload = failed?.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const reason = (payload as Record<string, unknown>)["reason"];
    if (typeof reason === "string" && reason.length > 0) return reason;
  }
  return undefined;
}
