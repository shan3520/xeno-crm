import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CommEventType } from "@xeno/shared";

import { PrismaService } from "../prisma/prisma.service";
import {
  ConversionPayloadSchema,
  type ReceiptDto,
  type ReceiptResult,
} from "./receipts.dto";
import { projectCommunication, type CommunicationProjection } from "./projection";

/** Prisma client inside an interactive transaction. */
type Tx = Prisma.TransactionClient;

/** Comm + its campaign context loaded once per receipt. */
interface CommContext {
  id: string;
  campaignId: string;
  customerId: string;
  campaign: { workspaceId: string; status: string };
}

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ingest one lifecycle callback. Everything below happens in ONE transaction so the
   * event-insert, status projection, counter updates, attribution, and completion flip are
   * atomic. Fully idempotent on idempotencyKey: a replayed callback inserts no event and
   * changes nothing downstream.
   */
  async ingest(dto: ReceiptDto): Promise<ReceiptResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const comm = (await tx.communication.findUnique({
          where: { id: dto.communicationId },
          select: {
            id: true,
            campaignId: true,
            customerId: true,
            campaign: { select: { workspaceId: true, status: true } },
          },
        })) as CommContext | null;
        if (!comm) {
          throw new NotFoundException(`Communication ${dto.communicationId} not found`);
        }

        // 1. IDEMPOTENT INGEST — the @unique idempotencyKey + skipDuplicates dedupes.
        const inserted = await tx.communicationEvent.createMany({
          data: [
            {
              communicationId: dto.communicationId,
              type: dto.type,
              occurredAt: new Date(dto.occurredAt),
              payload: dto.payload as Prisma.InputJsonValue,
              idempotencyKey: dto.idempotencyKey,
            },
          ],
          skipDuplicates: true,
        });
        if (inserted.count === 0) {
          // Duplicate callback — no event added, nothing downstream changes.
          return { ok: true, duplicate: true };
        }

        // 2. PROJECT status from the full (now-updated) event set.
        const events = await tx.communicationEvent.findMany({
          where: { communicationId: dto.communicationId },
          select: { type: true, occurredAt: true },
        });
        const projection = projectCommunication(events);
        await tx.communication.update({
          where: { id: dto.communicationId },
          data: this.projectionToUpdate(projection, dto),
        });

        // 3/4. COUNTERS + ATTRIBUTION — only on this comm's FIRST event of this type.
        const firstOfType =
          events.filter((e) => e.type === dto.type).length === 1;
        if (firstOfType) {
          if (dto.type === "CONVERTED") {
            await this.attribute(tx, comm, dto, projection.convertedAt);
          } else {
            const increment = counterIncrement(dto.type);
            if (increment) {
              await tx.campaign.update({ where: { id: comm.campaignId }, data: increment });
            }
          }
        }

        // 5. COMPLETION — flip SENDING→COMPLETED once no comm is in-flight.
        await this.maybeComplete(tx, comm.campaignId, comm.campaign.status);

        return { ok: true, duplicate: false, status: projection.status };
      },
      { timeout: 20_000 },
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Build the Communication update. status is always set (the projection result). Each *At
   * is only WRITTEN when present, so we never clobber an existing timestamp with null (e.g.
   * the worker's sentAt before the SENT receipt arrives). failureReason comes from the
   * incoming FAILED payload.
   */
  private projectionToUpdate(
    p: CommunicationProjection,
    dto: ReceiptDto,
  ): Prisma.CommunicationUpdateInput {
    const data: Prisma.CommunicationUpdateInput = { status: p.status };
    if (p.sentAt) data.sentAt = p.sentAt;
    if (p.deliveredAt) data.deliveredAt = p.deliveredAt;
    if (p.openedAt) data.openedAt = p.openedAt;
    if (p.readAt) data.readAt = p.readAt;
    if (p.clickedAt) data.clickedAt = p.clickedAt;
    if (p.failedAt) data.failedAt = p.failedAt;
    if (p.convertedAt) data.convertedAt = p.convertedAt;
    if (p.status === "FAILED") {
      const reason = typeof dto.payload?.reason === "string" ? dto.payload.reason : undefined;
      data.failureReason = reason ?? "channel reported delivery failure";
    }
    return data;
  }

  /**
   * Attribute a CONVERTED to exactly one Order and bump convertedCount + attributedRevenue.
   * Idempotent: respects the @unique attributedCommunicationId (one order per comm) and the
   * Order @@unique(workspaceId, externalId). Called only on a comm's first CONVERTED event.
   */
  private async attribute(
    tx: Tx,
    comm: CommContext,
    dto: ReceiptDto,
    convertedAt: Date | null,
  ): Promise<void> {
    // Hard backstop: never create a second order for a comm already attributed.
    const already = await tx.order.findUnique({
      where: { attributedCommunicationId: comm.id },
      select: { id: true },
    });
    if (already) return;

    const parsed = ConversionPayloadSchema.safeParse(dto.payload);
    if (!parsed.success) {
      // Count the conversion, but without a valid payload there is no revenue to attribute.
      this.logger.warn(`CONVERTED ${comm.id}: invalid payload, counted without an order`);
      await tx.campaign.update({
        where: { id: comm.campaignId },
        data: { convertedCount: { increment: 1 } },
      });
      return;
    }

    const { externalId, amount, currency, orderedAt } = parsed.data;
    const revenue = new Prisma.Decimal(amount);
    const orderedAtDate = orderedAt ? new Date(orderedAt) : (convertedAt ?? new Date());

    // Respect Order @@unique(workspaceId, externalId): link an existing order rather than dupe.
    const existing = await tx.order.findUnique({
      where: { workspaceId_externalId: { workspaceId: comm.campaign.workspaceId, externalId } },
      select: { id: true, attributedCommunicationId: true },
    });
    if (existing) {
      if (!existing.attributedCommunicationId) {
        await tx.order.update({
          where: { id: existing.id },
          data: { attributedCommunicationId: comm.id },
        });
      }
    } else {
      await tx.order.create({
        data: {
          workspaceId: comm.campaign.workspaceId,
          customerId: comm.customerId,
          externalId,
          totalAmount: revenue,
          currency,
          status: "paid",
          orderedAt: orderedAtDate,
          attributedCommunicationId: comm.id,
        },
      });
    }

    await tx.campaign.update({
      where: { id: comm.campaignId },
      data: {
        convertedCount: { increment: 1 },
        attributedRevenue: { increment: revenue },
      },
    });
  }

  /**
   * Completion rule: a campaign is COMPLETED once NO comm remains in-flight — i.e. none are
   * QUEUED or SENT. Every comm has either advanced past the send path (DELIVERED+ — further
   * engagement is optional) or terminated as FAILED. The flip is one-way and guarded on
   * status='SENDING', so it fires at most once and never reopens.
   */
  private async maybeComplete(
    tx: Tx,
    campaignId: string,
    currentStatus: string,
  ): Promise<void> {
    if (currentStatus !== "SENDING") return;
    const inFlight = await tx.communication.count({
      where: { campaignId, status: { in: ["QUEUED", "SENT"] } },
    });
    if (inFlight === 0) {
      await tx.campaign.updateMany({
        where: { id: campaignId, status: "SENDING" },
        data: { status: "COMPLETED" },
      });
    }
  }
}

/** Funnel counter increment for a first-seen event type (null for SENT/CONVERTED). */
function counterIncrement(type: CommEventType): Prisma.CampaignUpdateInput | null {
  switch (type) {
    case "DELIVERED":
      return { deliveredCount: { increment: 1 } };
    case "OPENED":
      return { openedCount: { increment: 1 } };
    case "READ":
      return { readCount: { increment: 1 } };
    case "CLICKED":
      return { clickedCount: { increment: 1 } };
    case "FAILED":
      return { failedCount: { increment: 1 } };
    default:
      // SENT (owned by the worker's sentCount) and CONVERTED (handled in attribute).
      return null;
  }
}
