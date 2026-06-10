/// <reference types="vitest/globals" />
import { Prisma } from "@prisma/client";

import {
  buildStatRows,
  computeStatsFromOrders,
  type OrderAggregate,
} from "./stats.util";

/** Build a Prisma-groupBy-shaped aggregate row for a customer's order set. */
function aggregate(
  customerId: string,
  orders: { totalAmount: string; orderedAt: string }[],
): OrderAggregate {
  const stats = computeStatsFromOrders(
    orders.map((o) => ({ totalAmount: o.totalAmount, orderedAt: new Date(o.orderedAt) })),
  );
  return {
    customerId,
    _sum: { totalAmount: orders.length ? stats.totalSpend : null },
    _count: { _all: stats.orderCount },
    _min: { orderedAt: stats.firstOrderAt },
    _max: { orderedAt: stats.lastOrderAt },
  };
}

describe("denormalized customer stats", () => {
  // ─── computeStatsFromOrders (correctness reference) ───────────────

  describe("computeStatsFromOrders", () => {
    it("sums totals in Decimal space and finds first/last order dates", () => {
      const orders = [
        { totalAmount: "1999.95", orderedAt: new Date("2026-01-10T00:00:00Z") },
        { totalAmount: "0.05", orderedAt: new Date("2026-03-02T00:00:00Z") },
        { totalAmount: "500.00", orderedAt: new Date("2025-12-01T00:00:00Z") },
      ];

      const stats = computeStatsFromOrders(orders);

      // 1999.95 + 0.05 + 500.00 = 2500.00 exactly — no float drift (0.1 + 0.2 style).
      expect(stats.totalSpend.toFixed(2)).toBe("2500.00");
      expect(stats.orderCount).toBe(3);
      expect(stats.firstOrderAt?.toISOString()).toBe("2025-12-01T00:00:00.000Z");
      expect(stats.lastOrderAt?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    });

    it("returns zero/null for a customer with no orders", () => {
      const stats = computeStatsFromOrders([]);
      expect(stats.totalSpend.toFixed(2)).toBe("0.00");
      expect(stats.orderCount).toBe(0);
      expect(stats.firstOrderAt).toBeNull();
      expect(stats.lastOrderAt).toBeNull();
    });

    it("is order-insensitive: shuffling the order set yields identical stats", () => {
      const orders = [
        { totalAmount: "10.10", orderedAt: new Date("2026-02-01T00:00:00Z") },
        { totalAmount: "20.20", orderedAt: new Date("2026-01-01T00:00:00Z") },
        { totalAmount: "30.30", orderedAt: new Date("2026-03-01T00:00:00Z") },
      ];
      const reversed = [...orders].reverse();

      const a = computeStatsFromOrders(orders);
      const b = computeStatsFromOrders(reversed);

      expect(a.totalSpend.equals(b.totalSpend)).toBe(true);
      expect(a.firstOrderAt?.getTime()).toBe(b.firstOrderAt?.getTime());
      expect(a.lastOrderAt?.getTime()).toBe(b.lastOrderAt?.getTime());
    });
  });

  // ─── buildStatRows (recompute correctness + idempotency) ──────────

  describe("buildStatRows", () => {
    it("maps grouped aggregates onto touched customers correctly", () => {
      const aggA = aggregate("cust_a", [
        { totalAmount: "100.00", orderedAt: "2026-01-01T00:00:00Z" },
        { totalAmount: "250.50", orderedAt: "2026-02-15T00:00:00Z" },
      ]);

      const rows = buildStatRows(["cust_a"], [aggA]);

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.customerId).toBe("cust_a");
      expect(row.totalSpend.toFixed(2)).toBe("350.50");
      expect(row.orderCount).toBe(2);
      expect(row.firstOrderAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(row.lastOrderAt?.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    });

    it("resets touched customers with no aggregate row to zero/null", () => {
      // cust_b had all its orders removed — it must appear, reset, not be skipped.
      const aggA = aggregate("cust_a", [
        { totalAmount: "100.00", orderedAt: "2026-01-01T00:00:00Z" },
      ]);

      const rows = buildStatRows(["cust_a", "cust_b"], [aggA]);
      const byId = new Map(rows.map((r) => [r.customerId, r]));

      const b = byId.get("cust_b")!;
      expect(b.totalSpend.toFixed(2)).toBe("0.00");
      expect(b.orderCount).toBe(0);
      expect(b.firstOrderAt).toBeNull();
      expect(b.lastOrderAt).toBeNull();
    });

    it("matches the computeStatsFromOrders reference for the same order set", () => {
      const orders = [
        { totalAmount: "12.34", orderedAt: "2026-01-05T00:00:00Z" },
        { totalAmount: "56.78", orderedAt: "2026-04-05T00:00:00Z" },
        { totalAmount: "90.00", orderedAt: "2026-02-05T00:00:00Z" },
      ];
      const reference = computeStatsFromOrders(
        orders.map((o) => ({ totalAmount: o.totalAmount, orderedAt: new Date(o.orderedAt) })),
      );

      const row = buildStatRows(["cust_a"], [aggregate("cust_a", orders)])[0]!;

      expect(row.totalSpend.equals(reference.totalSpend)).toBe(true);
      expect(row.orderCount).toBe(reference.orderCount);
      expect(row.firstOrderAt?.getTime()).toBe(reference.firstOrderAt?.getTime());
      expect(row.lastOrderAt?.getTime()).toBe(reference.lastOrderAt?.getTime());
    });

    it("is idempotent: recomputing the same aggregates twice yields identical rows", () => {
      const aggs = [
        aggregate("cust_a", [
          { totalAmount: "100.00", orderedAt: "2026-01-01T00:00:00Z" },
          { totalAmount: "200.00", orderedAt: "2026-02-01T00:00:00Z" },
        ]),
        aggregate("cust_b", [
          { totalAmount: "75.25", orderedAt: "2026-03-01T00:00:00Z" },
        ]),
      ];
      const ids = ["cust_a", "cust_b"];

      const first = buildStatRows(ids, aggs);
      const second = buildStatRows(ids, aggs);

      const norm = (rows: ReturnType<typeof buildStatRows>) =>
        rows.map((r) => ({
          customerId: r.customerId,
          totalSpend: r.totalSpend.toFixed(2),
          orderCount: r.orderCount,
          firstOrderAt: r.firstOrderAt?.toISOString() ?? null,
          lastOrderAt: r.lastOrderAt?.toISOString() ?? null,
        }));

      expect(norm(first)).toEqual(norm(second));
      // And the values are the expected stable result.
      expect(norm(first)).toEqual([
        {
          customerId: "cust_a",
          totalSpend: "300.00",
          orderCount: 2,
          firstOrderAt: "2026-01-01T00:00:00.000Z",
          lastOrderAt: "2026-02-01T00:00:00.000Z",
        },
        {
          customerId: "cust_b",
          totalSpend: "75.25",
          orderCount: 1,
          firstOrderAt: "2026-03-01T00:00:00.000Z",
          lastOrderAt: "2026-03-01T00:00:00.000Z",
        },
      ]);
    });

    it("preserves Decimal precision (no float accumulation) across many small orders", () => {
      // 10 orders of 0.10 => exactly 1.00 in Decimal; float would give 0.9999999999999999.
      const orders = Array.from({ length: 10 }, (_, i) => ({
        totalAmount: "0.10",
        orderedAt: new Date(2026, 0, i + 1).toISOString(),
      }));
      const agg = aggregate("cust_a", orders);

      const row = buildStatRows(["cust_a"], [agg])[0]!;
      expect(row.totalSpend.equals(new Prisma.Decimal("1.00"))).toBe(true);
    });
  });
});
