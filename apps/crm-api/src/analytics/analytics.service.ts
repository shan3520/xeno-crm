import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type {
  CampaignMeta,
  CampaignStatsResponse,
  CampaignSummaryRow,
  DerivedRates,
  FailureEntry,
  FunnelCounts,
  OverviewResponse,
  OverviewTotals,
  TimelineBucket,
} from "./analytics.types";

/** Compute a rate safely — returns 0 when the denominator is 0. */
function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000; // 4 decimal places
}

/**
 * Pick the bucket stride (a Postgres `interval`) based on campaign age. These feed `date_bin`,
 * NOT `date_trunc`: date_trunc only accepts a single named field (minute/hour/day…) and throws
 * 22023 on a multi-unit interval like '15 minutes', whereas date_bin bins on an arbitrary
 * fixed-width stride. So every tier here — including the multi-unit '15 minutes' — is valid.
 */
function chooseBucketInterval(launchedAt: Date | null): string {
  if (!launchedAt) return "1 hour";
  const ageMs = Date.now() - launchedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours <= 1) return "1 minute";
  if (ageHours <= 24) return "15 minutes";
  if (ageHours <= 168) return "1 hour"; // 7 days
  return "1 day";
}

/**
 * Fixed origin for `date_bin` (the Unix epoch, UTC). Binning against a constant UTC instant
 * makes every bucket boundary stable and session-timezone-independent: a '1 day' stride lands
 * on UTC midnight, '1 hour' on the UTC hour, '15 minutes' on :00/:15/:30/:45, etc. (date_trunc,
 * by contrast, aligned day/hour buckets to the session TimeZone.) Stored timestamps are
 * timestamptz/UTC, so this is the natural, deterministic reference.
 */
const BUCKET_ORIGIN = new Date(0);

/** Shape of each row returned by the timeline raw query. */
interface TimelineRow {
  bucket: Date;
  type: string;
  count: bigint;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Single campaign stats ────────────────────────────────────────

  async getCampaignStats(campaignId: string): Promise<CampaignStatsResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException(`Campaign ${campaignId} not found`);
    }

    const meta: CampaignMeta = {
      id: campaign.id,
      name: campaign.name,
      goal: campaign.goal,
      channel: campaign.channel as CampaignMeta["channel"],
      status: campaign.status as CampaignMeta["status"],
      audienceSize: campaign.audienceSize,
      launchedAt: campaign.launchedAt?.toISOString() ?? null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };

    const funnel: FunnelCounts = {
      queued: campaign.queuedCount,
      sent: campaign.sentCount,
      delivered: campaign.deliveredCount,
      opened: campaign.openedCount,
      read: campaign.readCount,
      clicked: campaign.clickedCount,
      converted: campaign.convertedCount,
      failed: campaign.failedCount,
    };

    const rates = computeRates(funnel);

    const [failureBreakdown, timeline] = await Promise.all([
      this.getFailureBreakdown(campaignId),
      this.getTimeline(campaignId, campaign.launchedAt),
    ]);

    return {
      campaign: meta,
      funnel,
      rates,
      attributedRevenue: campaign.attributedRevenue.toString(),
      failureBreakdown,
      timeline,
    };
  }

  // ─── Workspace overview ───────────────────────────────────────────

  async getOverview(): Promise<OverviewResponse> {
    // Single-workspace system: resolve the one seeded workspace.
    const workspace = await this.prisma.workspace.findFirstOrThrow();

    const campaigns = await this.prisma.campaign.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    });

    // Build per-campaign summary rows + accumulate totals in one pass.
    let totalSent = 0;
    let totalDelivered = 0;
    let totalOpened = 0;
    let totalClicked = 0;
    let totalConverted = 0;
    let totalFailed = 0;
    let totalRevenue = new Prisma.Decimal(0);

    const rows: CampaignSummaryRow[] = campaigns.map((c) => {
      totalSent += c.sentCount;
      totalDelivered += c.deliveredCount;
      totalOpened += c.openedCount;
      totalClicked += c.clickedCount;
      totalConverted += c.convertedCount;
      totalFailed += c.failedCount;
      totalRevenue = totalRevenue.add(c.attributedRevenue);

      return {
        id: c.id,
        name: c.name,
        channel: c.channel as CampaignSummaryRow["channel"],
        status: c.status as CampaignSummaryRow["status"],
        audienceSize: c.audienceSize,
        launchedAt: c.launchedAt?.toISOString() ?? null,
        sent: c.sentCount,
        delivered: c.deliveredCount,
        opened: c.openedCount,
        clicked: c.clickedCount,
        converted: c.convertedCount,
        failed: c.failedCount,
        attributedRevenue: c.attributedRevenue.toString(),
        deliveryRate: rate(c.deliveredCount, c.sentCount),
        openRate: rate(c.openedCount, c.deliveredCount),
      };
    });

    const totals: OverviewTotals = {
      campaigns: campaigns.length,
      sent: totalSent,
      delivered: totalDelivered,
      opened: totalOpened,
      clicked: totalClicked,
      converted: totalConverted,
      failed: totalFailed,
      attributedRevenue: totalRevenue.toString(),
    };

    return {
      totals,
      rates: {
        deliveryRate: rate(totalDelivered, totalSent),
        openRate: rate(totalOpened, totalDelivered),
        clickRate: rate(totalClicked, totalOpened),
        conversionRate: rate(totalConverted, totalDelivered),
      },
      campaigns: rows,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async getFailureBreakdown(
    campaignId: string,
  ): Promise<FailureEntry[]> {
    const grouped = await this.prisma.communication.groupBy({
      by: ["failureReason"],
      where: {
        campaignId,
        failureReason: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { failureReason: "desc" } },
    });

    return grouped.map((g) => ({
      reason: g.failureReason ?? "Unknown",
      count: g._count._all,
    }));
  }

  private async getTimeline(
    campaignId: string,
    launchedAt: Date | null,
  ): Promise<TimelineBucket[]> {
    const interval = chooseBucketInterval(launchedAt);

    // Bucket with date_bin (Postgres 14+), which accepts an arbitrary fixed-width stride — so
    // every tier, including the multi-unit '15 minutes', is valid (date_trunc only takes a
    // single field and 22023s on '15 minutes'). The stride is bound as a parameter and cast to
    // `interval`; the origin is a fixed UTC instant for stable, timezone-independent boundaries.
    // Prisma default naming: PascalCase tables, camelCase columns (no @@map/@map), so identifiers
    // are case-sensitive and double-quoted. Join CommunicationEvent → Communication to scope by
    // campaignId. All values are parameterized — no string interpolation of untrusted input.
    //
    // MANUAL CHECK (multi-unit tier): against the seeded DB, pick a campaign whose launchedAt is
    // 1–24h ago (so chooseBucketInterval → '15 minutes') and hit GET /campaigns/:id/stats — it
    // must return 200 with a populated `timeline`. Before this fix that path 500'd with
    // 'unit "15 minutes" not recognized'. Spot-check every tier by varying launchedAt age.
    const rows = await this.prisma.$queryRaw<TimelineRow[]>`
      SELECT
        date_bin(${interval}::interval, ce."occurredAt", ${BUCKET_ORIGIN}) AS bucket,
        ce."type"                                                          AS type,
        COUNT(*)::bigint                                                   AS count
      FROM "CommunicationEvent" ce
      JOIN "Communication" c ON c."id" = ce."communicationId"
      WHERE c."campaignId" = ${campaignId}
        AND ce."type" IN ('SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED')
      GROUP BY bucket, ce."type"
      ORDER BY bucket ASC
    `;

    return pivotTimeline(rows);
  }
}

// ─── Pure helpers (exported for testing) ────────────────────────────

export function computeRates(funnel: FunnelCounts): DerivedRates {
  return {
    deliveryRate: rate(funnel.delivered, funnel.sent),
    openRate: rate(funnel.opened, funnel.delivered),
    clickRate: rate(funnel.clicked, funnel.opened),
    conversionRate: rate(funnel.converted, funnel.delivered),
  };
}

export function pivotTimeline(rows: TimelineRow[]): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>();

  for (const row of rows) {
    const key = row.bucket.toISOString();
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { bucket: key, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };
      map.set(key, bucket);
    }

    const count = Number(row.count);
    switch (row.type) {
      case "SENT":
        bucket.sent += count;
        break;
      case "DELIVERED":
        bucket.delivered += count;
        break;
      case "OPENED":
        bucket.opened += count;
        break;
      case "CLICKED":
        bucket.clicked += count;
        break;
      case "FAILED":
        bucket.failed += count;
        break;
    }
  }

  return Array.from(map.values());
}
