import { describe, expect, it } from "vitest";

import {
  SegmentDefinitionSchema,
  validateSegmentDefinition,
  type SegmentDefinition,
} from "./segment";

/**
 * A deeply-nested "lapsed sneaker buyers" rule:
 *   bought sneakers AND haven't ordered in 90 days
 *   AND (high spend OR a premium tier)
 *   AND NOT in an excluded city.
 */
const lapsedSneakerRule: SegmentDefinition = {
  op: "AND",
  conditions: [
    { field: "order_item.category", operator: "eq", value: "sneakers" },
    { field: "customer.last_order_at", operator: "older_than_days", value: 90 },
    {
      op: "OR",
      conditions: [
        { field: "customer.total_spend", operator: "gte", value: 5000 },
        { field: "customer.tier", operator: "in", value: ["gold", "platinum"] },
      ],
    },
    {
      op: "NOT",
      conditions: [
        { field: "customer.city", operator: "in", value: ["Test City"] },
      ],
    },
  ],
};

describe("segment DSL validation", () => {
  it("parses a deeply-nested AND/OR/NOT rule", () => {
    const result = validateSegmentDefinition(lapsedSneakerRule);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Round-trips structurally unchanged.
      expect(result.value).toEqual(lapsedSneakerRule);
    }
    // The schema itself also accepts it.
    expect(SegmentDefinitionSchema.safeParse(lapsedSneakerRule).success).toBe(
      true,
    );
  });

  it("rejects an unknown field", () => {
    const badField = {
      op: "AND",
      conditions: [
        { field: "customer.unknown_field", operator: "eq", value: 1 },
      ],
    };
    const result = validateSegmentDefinition(badField);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown operator", () => {
    const badOperator = {
      op: "AND",
      conditions: [
        { field: "customer.city", operator: "like", value: "Mumbai" },
      ],
    };
    const result = validateSegmentDefinition(badOperator);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object / structurally invalid rule", () => {
    expect(validateSegmentDefinition(null).ok).toBe(false);
    expect(validateSegmentDefinition({ op: "AND" }).ok).toBe(false);
    expect(validateSegmentDefinition({ op: "AND", conditions: [] }).ok).toBe(
      false,
    );
  });
});
