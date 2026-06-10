/// <reference types="vitest/globals" />
import { GenerateSegmentRuleOutputSchema } from "@xeno/shared";

import { parseJsonObject } from "@/lib/ai/tools";

/**
 * Proves the tool's validation gate: a model-proposed rule with a non-whitelisted field fails
 * @xeno/shared validation, so it returns a typed validation_failed result and NEVER reaches
 * /segments/preview or the DB. This is the same parse the generate_segment_rule tool runs.
 */
describe("generate_segment_rule validation gate", () => {
  const wrap = (definition: unknown): string =>
    JSON.stringify({ name: "Lapsed buyers", description: "test", definition });

  it("accepts a whitelisted lapsed-sneaker rule", () => {
    const text = wrap({
      op: "AND",
      conditions: [
        { field: "order_item.category", operator: "eq", value: "sneakers" },
        { field: "customer.last_order_at", operator: "older_than_days", value: 60 },
      ],
    });
    const parsed = GenerateSegmentRuleOutputSchema.safeParse(parseJsonObject(text));
    expect(parsed.success).toBe(true);
  });

  it("REJECTS a non-whitelisted field before it can hit preview/DB", () => {
    const text = wrap({
      op: "AND",
      conditions: [{ field: "customer.secret_internal_score", operator: "eq", value: 1 }],
    });
    const parsed = GenerateSegmentRuleOutputSchema.safeParse(parseJsonObject(text));
    expect(parsed.success).toBe(false);
  });

  it("REJECTS a non-whitelisted operator", () => {
    const text = wrap({
      op: "AND",
      conditions: [{ field: "customer.tier", operator: "regex_match", value: "gold" }],
    });
    const parsed = GenerateSegmentRuleOutputSchema.safeParse(parseJsonObject(text));
    expect(parsed.success).toBe(false);
  });

  it("parseJsonObject tolerates ```json fences around the object", () => {
    const fenced = "Here you go:\n```json\n{\"a\":1}\n```\nthanks";
    expect(parseJsonObject(fenced)).toEqual({ a: 1 });
  });
});
