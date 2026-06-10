import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CustomerIngest, OrderIngest } from "@xeno/shared";

import { PrismaService } from "../prisma/prisma.service";
import { CustomerStatsService } from "../customers/stats.service";
import { WorkspaceResolver } from "../customers/workspace.resolver";
import type {
  IngestCustomersDto,
  IngestCustomersResult,
  IngestOrdersDto,
  IngestOrdersResult,
} from "./ingest.dto";

/** Rows processed per atomic batch so a 2k+ ingest never blows one txn/timeout. */
const BATCH_SIZE = 500;
/** Bound on the IN-list size when pre-reading existing rows for counts/resolution. */
const READ_CHUNK = 1000;

const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 } as const;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

/** Parse an optional ISO datetime (nullable) into a Date or null. */
function toDateOrNull(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: CustomerStatsService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  // ─── Customers ────────────────────────────────────────────────────

  /**
   * Bulk idempotent upsert of customers by (workspaceId, externalId). Profile fields are
   * always refreshed; denormalized stats are only set when the payload carries `orderStats`
   * (so re-ingesting without stats never clobbers rollups maintained by order ingest).
   */
  async ingestCustomers(dto: IngestCustomersDto): Promise<IngestCustomersResult> {
    const workspaceId = await this.workspace.resolveId();
    const customers = dto.customers;

    const { created, updated } = await this.classifyByExternalId(
      customers.map((c) => c.externalId),
      (externalIds) =>
        this.prisma.customer.findMany({
          where: { workspaceId, externalId: { in: externalIds } },
          select: { externalId: true },
        }),
    );

    for (const batch of chunk(customers, BATCH_SIZE)) {
      await this.prisma.$transaction(
        async (tx) => {
          for (const c of batch) {
            await tx.customer.upsert({
              where: { workspaceId_externalId: { workspaceId, externalId: c.externalId } },
              create: this.customerCreateData(workspaceId, c),
              update: this.customerUpdateData(c),
            });
          }
        },
        TX_OPTIONS,
      );
    }

    return { created, updated };
  }

  // ─── Orders ───────────────────────────────────────────────────────

  /**
   * Bulk idempotent upsert of orders (by workspaceId+externalId), each referencing a
   * customer by externalId. OrderItems are replaced cleanly (delete-then-insert) per batch,
   * then every touched customer's denormalized stats are recomputed from their full order
   * set within the same transaction.
   */
  async ingestOrders(dto: IngestOrdersDto): Promise<IngestOrdersResult> {
    const workspaceId = await this.workspace.resolveId();
    const orders = dto.orders;

    const customerIdByExternal = await this.resolveCustomers(workspaceId, orders);

    const { created, updated } = await this.classifyByExternalId(
      orders.map((o) => o.externalId),
      (externalIds) =>
        this.prisma.order.findMany({
          where: { workspaceId, externalId: { in: externalIds } },
          select: { externalId: true },
        }),
    );

    const touchedCustomers = new Set<string>();

    for (const batch of chunk(orders, BATCH_SIZE)) {
      await this.prisma.$transaction(
        async (tx) => {
          const batchOrderIds: string[] = [];
          const batchCustomerIds = new Set<string>();
          // externalId -> resolved order id, to attach items after upsert.
          const orderIdByExternal = new Map<string, string>();

          for (const o of batch) {
            const customerId = customerIdByExternal.get(o.customerExternalId)!;
            const upserted = await tx.order.upsert({
              where: { workspaceId_externalId: { workspaceId, externalId: o.externalId } },
              create: {
                workspaceId,
                customerId,
                externalId: o.externalId,
                totalAmount: new Prisma.Decimal(o.totalAmount),
                currency: o.currency,
                status: o.status,
                orderedAt: new Date(o.orderedAt),
              },
              // Re-point customer + refresh fields, but never touch attribution.
              update: {
                customerId,
                totalAmount: new Prisma.Decimal(o.totalAmount),
                currency: o.currency,
                status: o.status,
                orderedAt: new Date(o.orderedAt),
              },
              select: { id: true },
            });
            batchOrderIds.push(upserted.id);
            orderIdByExternal.set(o.externalId, upserted.id);
            batchCustomerIds.add(customerId);
            touchedCustomers.add(customerId);
          }

          // Replace items cleanly: drop this batch's items, then re-insert.
          await tx.orderItem.deleteMany({ where: { orderId: { in: batchOrderIds } } });
          const itemRows = batch.flatMap((o) =>
            o.items.map((item) => ({
              orderId: orderIdByExternal.get(o.externalId)!,
              productName: item.productName,
              sku: item.sku ?? null,
              category: item.category ?? null,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
            })),
          );
          if (itemRows.length > 0) {
            await tx.orderItem.createMany({ data: itemRows });
          }

          // Recompute the customers touched by THIS batch from their full order set.
          await this.stats.recompute(tx, Array.from(batchCustomerIds));
        },
        TX_OPTIONS,
      );
    }

    return { created, updated, customersTouched: touchedCustomers.size };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /** Map each order's customerExternalId to a customer id; 400 on any unknown reference. */
  private async resolveCustomers(
    workspaceId: string,
    orders: OrderIngest[],
  ): Promise<Map<string, string>> {
    const externalIds = Array.from(new Set(orders.map((o) => o.customerExternalId)));
    const map = new Map<string, string>();

    for (const part of chunk(externalIds, READ_CHUNK)) {
      const rows = await this.prisma.customer.findMany({
        where: { workspaceId, externalId: { in: part } },
        select: { id: true, externalId: true },
      });
      for (const row of rows) map.set(row.externalId, row.id);
    }

    const missing = externalIds.filter((id) => !map.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown customerExternalId(s): ${missing.slice(0, 20).join(", ")}` +
          (missing.length > 20 ? ` (+${missing.length - 20} more)` : ""),
      );
    }
    return map;
  }

  /**
   * Classify payload rows into created vs updated by comparing each row's externalId to the
   * set already present in the DB. Tracks newly-seen ids so duplicates within one payload
   * count as a single create. Counts are derived independently of write batching.
   */
  private async classifyByExternalId(
    externalIds: string[],
    findExisting: (ids: string[]) => Promise<{ externalId: string }[]>,
  ): Promise<{ created: number; updated: number }> {
    const existing = new Set<string>();
    for (const part of chunk(Array.from(new Set(externalIds)), READ_CHUNK)) {
      const rows = await findExisting(part);
      for (const row of rows) existing.add(row.externalId);
    }

    let created = 0;
    let updated = 0;
    for (const externalId of externalIds) {
      if (existing.has(externalId)) {
        updated++;
      } else {
        created++;
        existing.add(externalId);
      }
    }
    return { created, updated };
  }

  private customerCreateData(
    workspaceId: string,
    c: CustomerIngest,
  ): Prisma.CustomerUncheckedCreateInput {
    const data: Prisma.CustomerUncheckedCreateInput = {
      workspaceId,
      externalId: c.externalId,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone ?? null,
      attributes: c.attributes as Prisma.InputJsonValue,
    };
    if (c.orderStats) {
      data.totalSpend = new Prisma.Decimal(c.orderStats.totalSpend);
      data.orderCount = c.orderStats.orderCount;
      data.firstOrderAt = toDateOrNull(c.orderStats.firstOrderAt);
      data.lastOrderAt = toDateOrNull(c.orderStats.lastOrderAt);
    }
    return data;
  }

  private customerUpdateData(c: CustomerIngest): Prisma.CustomerUncheckedUpdateInput {
    const data: Prisma.CustomerUncheckedUpdateInput = {
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone ?? null,
      attributes: c.attributes as Prisma.InputJsonValue,
    };
    // Only overwrite rollups when the payload explicitly carries them.
    if (c.orderStats) {
      data.totalSpend = new Prisma.Decimal(c.orderStats.totalSpend);
      data.orderCount = c.orderStats.orderCount;
      data.firstOrderAt = toDateOrNull(c.orderStats.firstOrderAt);
      data.lastOrderAt = toDateOrNull(c.orderStats.lastOrderAt);
    }
    return data;
  }
}
