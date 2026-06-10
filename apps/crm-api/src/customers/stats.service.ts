import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { buildStatRows } from "./stats.util";

/** Prisma client usable inside or outside an interactive transaction. */
type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class CustomerStatsService {
  /**
   * Recompute the denormalized rollups for the given customers from their FULL order set,
   * inside the caller's transaction. Uses ONE grouped aggregate query (no per-order JS
   * loop), then writes each touched customer's totals. Customers with no orders are reset
   * to zero/null. Idempotent: same orders in => same stats out.
   */
  async recompute(tx: PrismaTx, customerIds: string[]): Promise<void> {
    const ids = Array.from(new Set(customerIds));
    if (ids.length === 0) return;

    // Single grouped aggregate across all touched customers — not a per-row loop.
    const aggregates = await tx.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: ids } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _min: { orderedAt: true },
      _max: { orderedAt: true },
    });

    const rows = buildStatRows(ids, aggregates);

    // Apply per-customer totals. Sequential within the txn (Prisma interactive txns are
    // not concurrency-safe); bounded by the touched-customer count, not the order count.
    for (const row of rows) {
      await tx.customer.update({
        where: { id: row.customerId },
        data: {
          totalSpend: row.totalSpend,
          orderCount: row.orderCount,
          firstOrderAt: row.firstOrderAt,
          lastOrderAt: row.lastOrderAt,
        },
      });
    }
  }
}
