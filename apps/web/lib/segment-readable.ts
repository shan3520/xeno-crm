import {
  type SegmentDefinition,
  type SegmentField,
  type SegmentGroup,
  type SegmentLeaf,
  type SegmentOperator,
} from "@xeno/shared";

/**
 * Turns the segment DSL into plain marketer English and provides the small set of edit
 * primitives the SegmentRuleCard needs. The user only ADJUSTS the AI-emitted rule (operator /
 * value / field on existing leaves) — there is no free-form query builder here (CLAUDE.md #8).
 */

export function isGroup(node: SegmentDefinition): node is SegmentGroup {
  return (
    typeof (node as SegmentGroup).op === "string" &&
    Array.isArray((node as SegmentGroup).conditions)
  );
}

export function isLeaf(node: SegmentDefinition): node is SegmentLeaf {
  return !isGroup(node);
}

// ─── Human-readable rendering ───────────────────────────────────────

const FIELD_LABEL: Record<SegmentField, string> = {
  "customer.total_spend": "total spend",
  "customer.order_count": "orders placed",
  "customer.first_order_at": "first order",
  "customer.last_order_at": "last order",
  "customer.city": "city",
  "customer.tier": "tier",
  "customer.tags": "tags",
  "order_item.category": "category",
  "order.total_amount": "order amount",
  "order.status": "order status",
};

const MONEY_FIELDS = new Set<SegmentField>([
  "customer.total_spend",
  "order.total_amount",
]);

function formatScalar(field: SegmentField, value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (MONEY_FIELDS.has(field) && typeof value === "number") {
    return `₹${value.toLocaleString("en-IN")}`;
  }
  return String(value);
}

const OP_PHRASE: Record<SegmentOperator, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  not_in: "is not one of",
  gt: "over",
  gte: "at least",
  lt: "under",
  lte: "at most",
  contains: "contains",
  within_days: "within",
  older_than_days: "older than",
};

/** One leaf as a phrase, with friendly special-cases for recency + category. */
export function readableLeaf(leaf: SegmentLeaf): string {
  const { field, operator, value } = leaf;

  if (operator === "older_than_days") {
    return `${FIELD_LABEL[field]} over ${value} days ago`;
  }
  if (operator === "within_days") {
    return `${FIELD_LABEL[field]} within the last ${value} days`;
  }
  if (field === "order_item.category" && (operator === "eq" || operator === "in")) {
    return `bought ${formatScalar(field, value)}`;
  }
  return `${FIELD_LABEL[field]} ${OP_PHRASE[operator]} ${formatScalar(field, value)}`;
}

function readableNode(node: SegmentDefinition, top: boolean): string {
  if (isLeaf(node)) return readableLeaf(node);

  const joiner = node.op === "OR" ? " or " : " and ";
  const parts = node.conditions.map((c) => readableNode(c, false));

  if (node.op === "NOT") {
    return `not (${parts.join(" and ")})`;
  }
  const joined = parts.join(joiner);
  // Parenthesize nested groups so precedence stays legible; the top group reads bare.
  return top || parts.length <= 1 ? joined : `(${joined})`;
}

/** "bought sneakers and last order over 60 days ago" */
export function readableDefinition(def: SegmentDefinition): string {
  return readableNode(def, true);
}

// ─── Leaf collection + immutable update (for inline edit) ───────────

export interface LeafRef {
  /** Index path from the root to this leaf, e.g. [0] or [1, 2]. */
  path: number[];
  leaf: SegmentLeaf;
}

/** Depth-first list of every leaf with the path needed to update it. */
export function collectLeaves(
  node: SegmentDefinition,
  path: number[] = [],
): LeafRef[] {
  if (isLeaf(node)) return [{ path, leaf: node }];
  return node.conditions.flatMap((child, i) =>
    collectLeaves(child, [...path, i]),
  );
}

/** Return a deep clone of `root` with the leaf at `path` replaced by `next`. */
export function updateLeafAt(
  root: SegmentDefinition,
  path: number[],
  next: SegmentLeaf,
): SegmentDefinition {
  const clone: SegmentDefinition =
    typeof structuredClone === "function"
      ? structuredClone(root)
      : (JSON.parse(JSON.stringify(root)) as SegmentDefinition);

  if (path.length === 0) return next;

  let cursor: SegmentDefinition = clone;
  for (let i = 0; i < path.length - 1; i++) {
    cursor = (cursor as SegmentGroup).conditions[path[i]!]!;
  }
  (cursor as SegmentGroup).conditions[path[path.length - 1]!] = next;
  return clone;
}
