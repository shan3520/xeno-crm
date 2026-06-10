import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Campaign, type Channel } from "@prisma/client";
import { validateSegmentDefinition, type SegmentDefinition } from "@xeno/shared";

import { WorkspaceResolver } from "../customers/workspace.resolver";
import { PrismaService } from "../prisma/prisma.service";
import {
  compileSegmentDefinition,
  SegmentCompileError,
} from "../segments/compiler/segment-compiler";
import type { CampaignCreateDto } from "./campaigns.dto";
import { renderMessage } from "./render";

/** Customers loaded per page when freezing the audience. */
const LAUNCH_BATCH = 1_000;
/** Generous ceiling: the whole snapshot runs in one interactive transaction. */
const LAUNCH_TX_OPTIONS = { timeout: 120_000, maxWait: 20_000 } as const;

export interface CampaignResponse {
  id: string;
  name: string;
  goal: string;
  segmentId: string | null;
  channel: Channel;
  status: Campaign["status"];
  messageTemplate: string;
  audienceSize: number;
  launchedAt: string | null;
  counters: {
    queued: number;
    sent: number;
    delivered: number;
    failed: number;
    opened: number;
    read: number;
    clicked: number;
    converted: number;
  };
  attributedRevenue: string;
  createdAt: string;
  updatedAt: string;
}

export interface LaunchResponse extends CampaignResponse {
  /** Customers in the frozen audience skipped because they had no address for the channel. */
  skippedNoAddress: number;
}

function mapCampaign(c: Campaign): CampaignResponse {
  return {
    id: c.id,
    name: c.name,
    goal: c.goal,
    segmentId: c.segmentId,
    channel: c.channel,
    status: c.status,
    messageTemplate: c.messageTemplate,
    audienceSize: c.audienceSize,
    launchedAt: c.launchedAt?.toISOString() ?? null,
    counters: {
      queued: c.queuedCount,
      sent: c.sentCount,
      delivered: c.deliveredCount,
      failed: c.failedCount,
      opened: c.openedCount,
      read: c.readCount,
      clicked: c.clickedCount,
      converted: c.convertedCount,
    },
    attributedRevenue: c.attributedRevenue.toFixed(2),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Resolve the recipient address for a channel; null when the customer lacks it. */
function resolveAddress(
  channel: Channel,
  customer: { email: string; phone: string | null },
): string | null {
  if (channel === "EMAIL") {
    const email = customer.email?.trim();
    return email ? email : null;
  }
  // SMS / WHATSAPP / RCS all use the phone number.
  const phone = customer.phone?.trim();
  return phone ? phone : null;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  // ─── Create draft ─────────────────────────────────────────────────

  /**
   * Create a DRAFT campaign. Audience source is either an existing segmentId or an inline
   * definition. The schema has no inline-definition column, so an inline rule is validated
   * (compiled) now to reject bad ones and materialized as a Segment row so launch can
   * recompile it from a stable source. If both are supplied, the explicit segmentId wins.
   */
  async create(dto: CampaignCreateDto): Promise<CampaignResponse> {
    const workspaceId = await this.workspace.resolveId();

    let segmentId: string | null = null;
    if (dto.segmentId) {
      const segment = await this.prisma.segment.findFirst({
        where: { id: dto.segmentId, workspaceId },
        select: { id: true },
      });
      if (!segment) {
        throw new BadRequestException(`Segment ${dto.segmentId} not found`);
      }
      segmentId = segment.id;
    } else if (dto.definition) {
      // Compile now purely to reject an invalid rule before persisting anything.
      this.compileOrThrow(workspaceId, dto.definition);
      const segment = await this.prisma.segment.create({
        data: {
          workspaceId,
          name: `${dto.name} (campaign audience)`,
          definition: dto.definition as unknown as Prisma.InputJsonValue,
          origin: "AI",
        },
        select: { id: true },
      });
      segmentId = segment.id;
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        workspaceId,
        name: dto.name,
        goal: dto.goal,
        channel: dto.channel,
        messageTemplate: dto.messageTemplate,
        segmentId,
        status: "DRAFT",
      },
    });

    return mapCampaign(campaign);
  }

  // ─── Reads ────────────────────────────────────────────────────────

  async list(): Promise<CampaignResponse[]> {
    const workspaceId = await this.workspace.resolveId();
    const campaigns = await this.prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return campaigns.map(mapCampaign);
  }

  async getOne(id: string): Promise<CampaignResponse> {
    return mapCampaign(await this.loadCampaign(id));
  }

  // ─── Launch ───────────────────────────────────────────────────────

  /**
   * Launch = the front half of the async send loop. In ONE transaction it freezes the
   * audience, writes QUEUED Communication rows (recipientAddress + renderedMessage are
   * SNAPSHOTS, immune to later customer edits) and flips the campaign to SENDING. It sends
   * nothing and never calls the channel stub — the queue worker claims the QUEUED rows.
   *
   * Batching + failure semantics: Communications are inserted in chunked `createMany` calls,
   * but ALL of them plus the status flip happen inside a single interactive transaction. So
   * the trade-off is a longer-held transaction in exchange for all-or-nothing semantics — if
   * any chunk fails, the whole launch rolls back and the campaign stays in its prior state
   * (DRAFT/FAILED) with zero Communications. There is never a partial SENDING.
   *
   * Double-launch safety: a compare-and-set (status DRAFT|FAILED -> LAUNCHING) inside the
   * transaction claims the launch; a concurrent or repeat launch matches 0 rows and gets a
   * 409 — so a second audience is never produced.
   */
  async launch(id: string): Promise<LaunchResponse> {
    const workspaceId = await this.workspace.resolveId();
    const campaign = await this.loadCampaign(id);

    // Fast-path guard for a clean 409 without opening a transaction.
    if (campaign.status !== "DRAFT" && campaign.status !== "FAILED") {
      throw new ConflictException(
        `Campaign ${id} is ${campaign.status}; only DRAFT or FAILED campaigns can launch`,
      );
    }

    const where = await this.resolveAudienceWhere(workspaceId, campaign);
    const now = new Date();

    const { updated, skipped } = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only succeeds from a launchable state. Prevents double-launch.
      const claim = await tx.campaign.updateMany({
        where: { id, status: { in: ["DRAFT", "FAILED"] } },
        data: { status: "LAUNCHING" },
      });
      if (claim.count === 0) {
        throw new ConflictException(`Campaign ${id} is already launching or launched`);
      }

      const audienceSize = await tx.customer.count({ where });

      // Page through the frozen audience, render per recipient, chunk-insert QUEUED rows.
      let queued = 0;
      let skippedNoAddress = 0;
      let cursor: string | undefined;

      for (;;) {
        const batch = await tx.customer.findMany({
          where,
          orderBy: { id: "asc" },
          take: LAUNCH_BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            attributes: true,
          },
        });
        if (batch.length === 0) break;

        const rows: Prisma.CommunicationCreateManyInput[] = [];
        for (const cust of batch) {
          const address = resolveAddress(campaign.channel, cust);
          if (!address) {
            skippedNoAddress++;
            continue;
          }
          rows.push({
            campaignId: id,
            customerId: cust.id,
            channel: campaign.channel,
            recipientAddress: address,
            renderedMessage: renderMessage(campaign.messageTemplate, {
              firstName: cust.firstName,
              lastName: cust.lastName,
              email: cust.email,
              phone: cust.phone,
              attributes: cust.attributes,
            }),
            status: "QUEUED",
            attemptCount: 0,
            nextAttemptAt: now, // claimable immediately by the worker
          });
        }

        if (rows.length > 0) {
          await tx.communication.createMany({ data: rows });
          queued += rows.length;
        }

        cursor = batch[batch.length - 1]!.id;
        if (batch.length < LAUNCH_BATCH) break;
      }

      const updatedCampaign = await tx.campaign.update({
        where: { id },
        data: {
          status: "SENDING",
          launchedAt: now,
          audienceSize,
          queuedCount: queued,
        },
      });

      return { updated: updatedCampaign, skipped: skippedNoAddress };
    }, LAUNCH_TX_OPTIONS);

    return { ...mapCampaign(updated), skippedNoAddress: skipped };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async loadCampaign(id: string): Promise<Campaign> {
    const workspaceId = await this.workspace.resolveId();
    const campaign = await this.prisma.campaign.findFirst({ where: { id, workspaceId } });
    if (!campaign) {
      throw new NotFoundException(`Campaign ${id} not found`);
    }
    return campaign;
  }

  /** Load the campaign's linked segment definition and compile it to a scoped where. */
  private async resolveAudienceWhere(
    workspaceId: string,
    campaign: Campaign,
  ): Promise<Prisma.CustomerWhereInput> {
    if (!campaign.segmentId) {
      throw new BadRequestException(
        `Campaign ${campaign.id} has no segment to resolve an audience`,
      );
    }
    const segment = await this.prisma.segment.findFirst({
      where: { id: campaign.segmentId, workspaceId },
      select: { definition: true },
    });
    if (!segment) {
      throw new BadRequestException(
        `Campaign ${campaign.id} references a missing segment ${campaign.segmentId}`,
      );
    }
    const parsed = validateSegmentDefinition(segment.definition);
    if (!parsed.ok) {
      throw new BadRequestException(`Segment definition is invalid: ${parsed.error}`);
    }
    return this.compileOrThrow(workspaceId, parsed.value);
  }

  /** Compile a definition to a workspace-scoped where, mapping compile errors to 400. */
  private compileOrThrow(
    workspaceId: string,
    definition: SegmentDefinition,
  ): Prisma.CustomerWhereInput {
    try {
      return { AND: [{ workspaceId }, compileSegmentDefinition(definition)] };
    } catch (err) {
      if (err instanceof SegmentCompileError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
