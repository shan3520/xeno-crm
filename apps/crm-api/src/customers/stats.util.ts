import { Prisma } from "@prisma/client";

/**
 * Pure helpers for the denormalized customer rollups (totalSpend, orderCount,
 * firstOrderAt, lastOrderAt). Kept free of Prisma/Nest I/O so the recompute logic is
 * unit-testable without a database. Money is summed via Prisma.Decimal — never float
 * accumulation.
 */

/** Per-customer aggregate as returned by Prisma `order.groupBy` (structural subset). */
export interface OrderAggregate {
  customerId: string;
  _sum: { totalAmount: Prisma.Decimal | null };
  _count: { _all: number };
  _min: { orderedAt: Date | null };
  _max: { orderedAt: Date | null };
}

/** Denormalized values to write back onto a Customer row. */
export interface CustomerStatRow {
  customerId: string;
  totalSpend: Prisma.Decimal;
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

/** A single order's money + timestamp, as needed to derive a customer's stats. */
export interface OrderForStats {
  totalAmount: Prisma.Decimal | string | number;
  orderedAt: Date;
}

/**
 * Canonical correctness reference: derive a customer's stats from their FULL order set.
 * Used by the recompute's tests as the source of truth and safe to call directly.
 * Sums in Decimal space so re-ordering or re-ingesting never drifts the total.
 */
export function computeStatsFromOrders(orders: OrderForStats[]): Omit<CustomerStatRow, "customerId"> {
  let totalSpend = new Prisma.Decimal(0);
  let firstOrderAt: Date | null = null;
  let lastOrderAt: Date | null = null;

  for (const order of orders) {
    totalSpend = totalSpend.add(new Prisma.Decimal(order.totalAmount));
    if (firstOrderAt === null || order.orderedAt < firstOrderAt) {
      firstOrderAt = order.orderedAt;
    }
    if (lastOrderAt === null || order.orderedAt > lastOrderAt) {
      lastOrderAt = order.orderedAt;
    }
  }

  return {
    totalSpend,
    orderCount: orders.length,
    firstOrderAt,
    lastOrderAt,
  };
}

/**
 * Map grouped order aggregates onto the full set of touched customer ids. Customers whose
 * orders all disappeared (no aggregate row) are reset to zero/null — so a recompute is
 * always correct regardless of ingest order, and stays stable on re-ingest.
 */
export function buildStatRows(
  touchedIds: string[],
  aggregates: OrderAggregate[],
): CustomerStatRow[] {
  const byCustomer = new Map<string, OrderAggregate>();
  for (const agg of aggregates) {
    byCustomer.set(agg.customerId, agg);
  }

  return touchedIds.map((customerId) => {
    const agg = byCustomer.get(customerId);
    if (!agg) {
      return {
        customerId,
        totalSpend: new Prisma.Decimal(0),
        orderCount: 0,
        firstOrderAt: null,
        lastOrderAt: null,
      };
    }
    return {
      customerId,
      totalSpend: agg._sum.totalAmount ?? new Prisma.Decimal(0),
      orderCount: agg._count._all,
      firstOrderAt: agg._min.orderedAt,
      lastOrderAt: agg._max.orderedAt,
    };
  });
}
