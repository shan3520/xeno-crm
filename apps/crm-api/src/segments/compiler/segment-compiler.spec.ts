/// <reference types="vitest/globals" />
import { Prisma } from "@prisma/client";
import type { SegmentDefinition } from "@xeno/shared";

import { compileSegmentDefinition, SegmentCompileError } from "./segment-compiler";

/** Build a leaf def without fighting the union types in tests. */
function leaf(field: string, operator: string, value: unknown): SegmentDefinition {
  return { field, operator, value } as unknown as SegmentDefinition;
}

describe("compileSegmentDefinition", () => {
  // ─── Group nesting ────────────────────────────────────────────────

  describe("group operators", () => {
    it("compiles AND into { AND: [...] }", () => {
      const where = compileSegmentDefinition({
        op: "AND",
        conditions: [
          leaf("customer.total_spend", "gte", 5000),
          leaf("customer.order_count", "gt", 2),
        ],
      } as SegmentDefinition);

      expect(where).toEqual({
        AND: [{ totalSpend: { gte: new Prisma.Decimal(5000) } }, { orderCount: { gt: 2 } }],
      });
    });

    it("compiles OR into { OR: [...] }", () => {
      const where = compileSegmentDefinition({
        op: "OR",
        conditions: [
          leaf("customer.tier", "eq", "gold"),
          leaf("customer.tier", "eq", "platinum"),
        ],
      } as SegmentDefinition);

      expect(where).toEqual({
        OR: [
          { attributes: { path: ["tier"], equals: "gold" } },
          { attributes: { path: ["tier"], equals: "platinum" } },
        ],
      });
    });

    it("compiles single-condition NOT into { NOT: <cond> }", () => {
      const where = compileSegmentDefinition({
        op: "NOT",
        conditions: [leaf("customer.city", "in", ["Test City"])],
      } as SegmentDefinition);

      expect(where).toEqual({
        NOT: { OR: [{ attributes: { path: ["city"], equals: "Test City" } }] },
      });
    });

    it("compiles multi-condition NOT into { NOT: { AND: [...] } }", () => {
      const where = compileSegmentDefinition({
        op: "NOT",
        conditions: [
          leaf("customer.tier", "eq", "bronze"),
          leaf("customer.order_count", "eq", 0),
        ],
      } as SegmentDefinition);

      expect(where).toEqual({
        NOT: {
          AND: [
            { attributes: { path: ["tier"], equals: "bronze" } },
            { orderCount: { equals: 0 } },
          ],
        },
      });
    });

    it("compiles a deeply nested AND/OR/NOT tree", () => {
      const where = compileSegmentDefinition({
        op: "AND",
        conditions: [
          leaf("order_item.category", "eq", "sneakers"),
          {
            op: "OR",
            conditions: [
              leaf("customer.total_spend", "gte", 5000),
              leaf("customer.tier", "in", ["gold", "platinum"]),
            ],
          },
          { op: "NOT", conditions: [leaf("customer.city", "eq", "Test City")] },
        ],
      } as SegmentDefinition);

      expect(where).toEqual({
        AND: [
          { orders: { some: { items: { some: { category: { equals: "sneakers" } } } } } },
          {
            OR: [
              { totalSpend: { gte: new Prisma.Decimal(5000) } },
              {
                OR: [
                  { attributes: { path: ["tier"], equals: "gold" } },
                  { attributes: { path: ["tier"], equals: "platinum" } },
                ],
              },
            ],
          },
          { NOT: { attributes: { path: ["city"], equals: "Test City" } } },
        ],
      });
    });
  });

  // ─── Operators ────────────────────────────────────────────────────

  describe("operators on scalar columns", () => {
    it("maps eq/neq/in/not_in/gt/gte/lt/lte", () => {
      expect(compileSegmentDefinition(leaf("customer.order_count", "eq", 3))).toEqual({
        orderCount: { equals: 3 },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "neq", 3))).toEqual({
        orderCount: { not: 3 },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "in", [1, 2]))).toEqual({
        orderCount: { in: [1, 2] },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "not_in", [1, 2]))).toEqual({
        orderCount: { notIn: [1, 2] },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "gt", 3))).toEqual({
        orderCount: { gt: 3 },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "gte", 3))).toEqual({
        orderCount: { gte: 3 },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "lt", 3))).toEqual({
        orderCount: { lt: 3 },
      });
      expect(compileSegmentDefinition(leaf("customer.order_count", "lte", 3))).toEqual({
        orderCount: { lte: 3 },
      });
    });

    it("compares money fields as Decimal", () => {
      const where = compileSegmentDefinition(leaf("customer.total_spend", "gte", 1500.5));
      expect(where).toEqual({ totalSpend: { gte: new Prisma.Decimal("1500.5") } });
      const decimal = (where.totalSpend as Prisma.DecimalFilter).gte;
      expect(decimal).toBeInstanceOf(Prisma.Decimal);
    });

    it("contains maps to insensitive contains on text", () => {
      expect(compileSegmentDefinition(leaf("order.status", "contains", "paid"))).toEqual({
        orders: { some: { status: { contains: "paid", mode: "insensitive" } } },
      });
    });
  });

  // ─── Relation fields ──────────────────────────────────────────────

  describe("relation fields", () => {
    it("order.total_amount -> orders some totalAmount (Decimal)", () => {
      expect(compileSegmentDefinition(leaf("order.total_amount", "gt", 2000))).toEqual({
        orders: { some: { totalAmount: { gt: new Prisma.Decimal(2000) } } },
      });
    });

    it("order.status -> orders some status", () => {
      expect(compileSegmentDefinition(leaf("order.status", "eq", "paid"))).toEqual({
        orders: { some: { status: { equals: "paid" } } },
      });
    });

    it("order_item.category -> orders some items some category", () => {
      expect(
        compileSegmentDefinition(leaf("order_item.category", "in", ["sneakers", "denim"])),
      ).toEqual({
        orders: {
          some: { items: { some: { category: { in: ["sneakers", "denim"] } } } },
        },
      });
    });

    it("tags array attribute -> array_contains", () => {
      expect(compileSegmentDefinition(leaf("customer.tags", "contains", "loyalty"))).toEqual({
        attributes: { path: ["tags"], array_contains: "loyalty" },
      });
      expect(compileSegmentDefinition(leaf("customer.tags", "in", ["loyalty", "vip"]))).toEqual({
        OR: [
          { attributes: { path: ["tags"], array_contains: "loyalty" } },
          { attributes: { path: ["tags"], array_contains: "vip" } },
        ],
      });
    });
  });

  // ─── Date math ────────────────────────────────────────────────────

  describe("relative-time operators", () => {
    it("within_days -> field >= now - N days (real Date, no SQL)", () => {
      const before = Date.now();
      const where = compileSegmentDefinition(leaf("customer.last_order_at", "within_days", 30));
      const after = Date.now();

      const gte = (where.lastOrderAt as Prisma.DateTimeFilter).gte as Date;
      expect(gte).toBeInstanceOf(Date);
      expect(gte.getTime()).toBeGreaterThanOrEqual(before - 30 * 86_400_000 - 5);
      expect(gte.getTime()).toBeLessThanOrEqual(after - 30 * 86_400_000 + 5);
    });

    it("older_than_days -> field <= now - N days (real Date)", () => {
      const before = Date.now();
      const where = compileSegmentDefinition(leaf("customer.last_order_at", "older_than_days", 60));
      const after = Date.now();

      const lte = (where.lastOrderAt as Prisma.DateTimeFilter).lte as Date;
      expect(lte).toBeInstanceOf(Date);
      expect(lte.getTime()).toBeGreaterThanOrEqual(before - 60 * 86_400_000 - 5);
      expect(lte.getTime()).toBeLessThanOrEqual(after - 60 * 86_400_000 + 5);
    });
  });

  // ─── Whitelist rejections (defense in depth) ──────────────────────

  describe("whitelist enforcement", () => {
    it("throws SegmentCompileError on an unknown field", () => {
      expect(() => compileSegmentDefinition(leaf("customer.ssn", "eq", "x"))).toThrow(
        SegmentCompileError,
      );
      expect(() => compileSegmentDefinition(leaf("customer.ssn", "eq", "x"))).toThrow(
        /Unknown field/,
      );
    });

    it("throws SegmentCompileError on an unknown operator", () => {
      expect(() => compileSegmentDefinition(leaf("customer.city", "like", "Mumbai"))).toThrow(
        SegmentCompileError,
      );
      expect(() => compileSegmentDefinition(leaf("customer.city", "like", "Mumbai"))).toThrow(
        /Unknown operator/,
      );
    });

    it("throws on operator/value-kind mismatch (in without array)", () => {
      expect(() => compileSegmentDefinition(leaf("customer.tier", "in", "gold"))).toThrow(
        SegmentCompileError,
      );
    });
  });
});
