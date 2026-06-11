import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Read-only database access for the post-run assertions. The harness NEVER writes through
 * this client — it only reads the event log (the source of truth) and the materialized
 * projections to compare them. The same generated Prisma client the API uses is reused so
 * the harness and the live path agree on the schema.
 */
export function makeReadClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: ["warn", "error"],
  });
}

/** One communication's stored projection. */
export interface CommRow {
  id: string;
  status: string;
}

/** One event from the append-only log. */
export interface EventRow {
  communicationId: string;
  type: string;
  occurredAt: Date;
  idempotencyKey: string;
}

/** Materialized campaign counters (the projection cache being verified). */
export interface CampaignRow {
  status: string;
  audienceSize: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  openedCount: number;
  readCount: number;
  clickedCount: number;
  convertedCount: number;
  attributedRevenue: Prisma.Decimal;
}

export async function loadCampaign(
  prisma: PrismaClient,
  campaignId: string,
): Promise<CampaignRow> {
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      status: true,
      audienceSize: true,
      queuedCount: true,
      sentCount: true,
      deliveredCount: true,
      failedCount: true,
      openedCount: true,
      readCount: true,
      clickedCount: true,
      convertedCount: true,
      attributedRevenue: true,
    },
  });
  return c;
}

export function loadComms(prisma: PrismaClient, campaignId: string): Promise<CommRow[]> {
  return prisma.communication.findMany({
    where: { campaignId },
    select: { id: true, status: true },
  });
}

export function loadEvents(prisma: PrismaClient, campaignId: string): Promise<EventRow[]> {
  return prisma.communicationEvent.findMany({
    where: { communication: { campaignId } },
    select: { communicationId: true, type: true, occurredAt: true, idempotencyKey: true },
  });
}

/** Sum of totalAmount over orders attributed to THIS campaign's communications. */
export async function attributedRevenueFromOrders(
  prisma: PrismaClient,
  campaignId: string,
): Promise<Prisma.Decimal> {
  const agg = await prisma.order.aggregate({
    _sum: { totalAmount: true },
    where: { attributedCommunication: { campaignId } },
  });
  return agg._sum.totalAmount ?? new Prisma.Decimal(0);
}

export function countEvents(prisma: PrismaClient, campaignId: string): Promise<number> {
  return prisma.communicationEvent.count({
    where: { communication: { campaignId } },
  });
}

export interface LagStats {
  n: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * Receipt lag = receivedAt - occurredAt (ms) across this campaign's events. occurredAt is the
 * stub's simulated channel time and receivedAt is when crm-api ingested the callback, so the
 * value can be negative (a callback can land before its simulated occurredAt) — reported as-is.
 */
export async function lagStats(
  prisma: PrismaClient,
  campaignId: string,
): Promise<LagStats> {
  const rows = await prisma.$queryRaw<
    { n: number; avg_ms: number | null; p95_ms: number | null; max_ms: number | null }[]
  >`
    SELECT
      COUNT(*)::int AS n,
      AVG(EXTRACT(EPOCH FROM (e."receivedAt" - e."occurredAt")) * 1000)::float8 AS avg_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (e."receivedAt" - e."occurredAt")) * 1000
      )::float8 AS p95_ms,
      MAX(EXTRACT(EPOCH FROM (e."receivedAt" - e."occurredAt")) * 1000)::float8 AS max_ms
    FROM "CommunicationEvent" e
    JOIN "Communication" c ON c."id" = e."communicationId"
    WHERE c."campaignId" = ${campaignId}
  `;
  const r = rows[0];
  return {
    n: r?.n ?? 0,
    avgMs: r?.avg_ms ?? 0,
    p95Ms: r?.p95_ms ?? 0,
    maxMs: r?.max_ms ?? 0,
  };
}
