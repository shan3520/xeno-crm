import { z } from "zod";

/**
 * Segment DSL — a recursive rule tree produced by the AI (or hand-edited) and later
 * compiled to SQL by crm-api against a field whitelist. This package ONLY defines and
 * validates the structural shape; it does NOT compile to SQL and has no DB imports.
 */

/**
 * Whitelisted fields. Anything outside this list is rejected at parse time. The compiler
 * in crm-api maps each of these to a concrete column/join — never accept a raw field.
 */
export const SEGMENT_FIELDS = [
  "customer.total_spend",
  "customer.order_count",
  "customer.first_order_at",
  "customer.last_order_at",
  "customer.city",
  "customer.tier",
  "customer.tags",
  "order_item.category",
  "order.total_amount",
  "order.status",
] as const;

export const SegmentFieldSchema = z.enum(SEGMENT_FIELDS);
export type SegmentField = z.infer<typeof SegmentFieldSchema>;

/** Whitelisted operators. Operator/value agreement is enforced later by the compiler. */
export const SEGMENT_OPERATORS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "within_days",
  "older_than_days",
] as const;

export const SegmentOperatorSchema = z.enum(SEGMENT_OPERATORS);
export type SegmentOperator = z.infer<typeof SegmentOperatorSchema>;

/** Boolean group operators. NOT wraps (negates) its conditions. */
export const SEGMENT_GROUP_OPS = ["AND", "OR", "NOT"] as const;
export const SegmentGroupOpSchema = z.enum(SEGMENT_GROUP_OPS);
export type SegmentGroupOp = z.infer<typeof SegmentGroupOpSchema>;

/**
 * Leaf `value` is intentionally permissive: a scalar or array of scalars. Operator-specific
 * semantics (e.g. `within_days`/`older_than_days` expect a single number; `in`/`not_in`
 * expect an array; `contains` expects a string) are NOT enforced here — the segment
 * compiler in crm-api validates value/operator agreement against the field whitelist.
 */
export const SegmentValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.array(z.number()),
]);
export type SegmentValue = z.infer<typeof SegmentValueSchema>;

/** A single comparison against one whitelisted field. */
export interface SegmentLeaf {
  field: SegmentField;
  operator: SegmentOperator;
  value: SegmentValue;
}

/** A boolean grouping of child nodes (AND / OR / NOT). */
export interface SegmentGroup {
  op: SegmentGroupOp;
  conditions: SegmentNode[];
}

export type SegmentNode = SegmentGroup | SegmentLeaf;

export const SegmentLeafSchema: z.ZodType<SegmentLeaf> = z.object({
  field: SegmentFieldSchema,
  operator: SegmentOperatorSchema,
  value: SegmentValueSchema,
});

// Recursion is expressed with z.lazy so the group can reference the node union, and the
// node union can reference the group. The explicit `z.ZodType<...>` annotations are what
// let TypeScript type the self-referential tree.
export const SegmentGroupSchema: z.ZodType<SegmentGroup> = z.lazy(() =>
  z.object({
    op: SegmentGroupOpSchema,
    conditions: z.array(SegmentNodeSchema).min(1),
  }),
);

export const SegmentNodeSchema: z.ZodType<SegmentNode> = z.lazy(() =>
  z.union([SegmentGroupSchema, SegmentLeafSchema]),
);

/** The root of a segment rule is any node (typically a group). */
export const SegmentDefinitionSchema: z.ZodType<SegmentNode> = SegmentNodeSchema;
export type SegmentDefinition = SegmentNode;

export type ValidateSegmentResult =
  | { ok: true; value: SegmentDefinition }
  | { ok: false; error: string };

/**
 * Parse + validate an untrusted JSON value as a segment definition. Returns a tagged
 * result rather than throwing, so callers (crm-api, the AI route) can surface a typed
 * "invalid rule" state. Rejects unknown fields and unknown operators.
 */
export function validateSegmentDefinition(json: unknown): ValidateSegmentResult {
  const result = SegmentDefinitionSchema.safeParse(json);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error.message };
}
