import { Prisma } from "@prisma/client";
import {
  SEGMENT_FIELDS,
  SEGMENT_OPERATORS,
  type SegmentDefinition,
  type SegmentLeaf,
  type SegmentNode,
  type SegmentOperator,
  type SegmentValue,
} from "@xeno/shared";

/**
 * Segment compiler — the security boundary between the AI's structured rule and the
 * database. A PURE function (no DB, no Nest): a validated DSL definition in, a
 * Prisma.CustomerWhereInput out. Every field/operator is re-checked against the
 * @xeno/shared whitelist (defense in depth) and unknowns THROW; values are only ever
 * passed as typed Prisma operands (Decimal/Date/string/number) — never interpolated into
 * raw SQL.
 */

/** Thrown on any whitelist violation or operator/value mismatch. Mapped to HTTP 400. */
export class SegmentCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentCompileError";
  }
}

const DAY_MS = 86_400_000;

const FIELD_SET: ReadonlySet<string> = new Set(SEGMENT_FIELDS);
const OPERATOR_SET: ReadonlySet<string> = new Set(SEGMENT_OPERATORS);

/** Cutoff Date for relative-time operators — computed in JS, passed as a real Date. */
function cutoff(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

// ─── Value guards (typed operands only) ──────────────────────────────

function asScalar(value: SegmentValue): string | number {
  if (Array.isArray(value)) {
    throw new SegmentCompileError("Operator expects a single scalar value, got an array");
  }
  return value;
}

function asNumber(value: SegmentValue): number {
  const scalar = asScalar(value);
  if (typeof scalar !== "number") {
    throw new SegmentCompileError(`Operator expects a number, got ${typeof scalar}`);
  }
  return scalar;
}

function asString(value: SegmentValue): string {
  const scalar = asScalar(value);
  if (typeof scalar !== "string") {
    throw new SegmentCompileError(`Operator expects a string, got ${typeof scalar}`);
  }
  return scalar;
}

function asArray(value: SegmentValue): (string | number)[] {
  if (!Array.isArray(value)) {
    throw new SegmentCompileError("Operator expects an array value");
  }
  return value;
}

function asStringArray(value: SegmentValue): string[] {
  return asArray(value).map((v) => String(v));
}

// ─── Typed scalar-filter builders (per column type) ──────────────────

function decimalFilter(op: SegmentOperator, value: SegmentValue): Prisma.DecimalFilter {
  const c = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
  switch (op) {
    case "eq":
      return { equals: c(asScalar(value)) };
    case "neq":
      return { not: c(asScalar(value)) };
    case "in":
      return { in: asArray(value).map(c) };
    case "not_in":
      return { notIn: asArray(value).map(c) };
    case "gt":
      return { gt: c(asNumber(value)) };
    case "gte":
      return { gte: c(asNumber(value)) };
    case "lt":
      return { lt: c(asNumber(value)) };
    case "lte":
      return { lte: c(asNumber(value)) };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for a money field`);
  }
}

function intFilter(op: SegmentOperator, value: SegmentValue): Prisma.IntFilter {
  switch (op) {
    case "eq":
      return { equals: asNumber(value) };
    case "neq":
      return { not: asNumber(value) };
    case "in":
      return { in: asArray(value).map(Number) };
    case "not_in":
      return { notIn: asArray(value).map(Number) };
    case "gt":
      return { gt: asNumber(value) };
    case "gte":
      return { gte: asNumber(value) };
    case "lt":
      return { lt: asNumber(value) };
    case "lte":
      return { lte: asNumber(value) };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for a count field`);
  }
}

function dateFilter(op: SegmentOperator, value: SegmentValue): Prisma.DateTimeFilter {
  const toDate = (v: SegmentValue): Date => new Date(asString(v));
  switch (op) {
    // Relative-time operators: compute the cutoff Date in JS, never interpolate.
    case "within_days":
      return { gte: cutoff(asNumber(value)) }; // ordered within the last N days
    case "older_than_days":
      return { lte: cutoff(asNumber(value)) }; // last activity at least N days ago
    case "eq":
      return { equals: toDate(value) };
    case "neq":
      return { not: toDate(value) };
    case "gt":
      return { gt: toDate(value) };
    case "gte":
      return { gte: toDate(value) };
    case "lt":
      return { lt: toDate(value) };
    case "lte":
      return { lte: toDate(value) };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for a date field`);
  }
}

function stringFilter(op: SegmentOperator, value: SegmentValue): Prisma.StringFilter {
  switch (op) {
    case "eq":
      return { equals: asString(value) };
    case "neq":
      return { not: asString(value) };
    case "in":
      return { in: asStringArray(value) };
    case "not_in":
      return { notIn: asStringArray(value) };
    case "contains":
      return { contains: asString(value), mode: "insensitive" };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for a text field`);
  }
}

// ─── JSON attribute helpers (city / tier / tags) ─────────────────────

function jsonEquals(path: string, value: string): Prisma.CustomerWhereInput {
  return { attributes: { path: [path], equals: value } };
}

function jsonStringWhere(
  path: string,
  op: SegmentOperator,
  value: SegmentValue,
): Prisma.CustomerWhereInput {
  switch (op) {
    case "eq":
      return jsonEquals(path, asString(value));
    case "neq":
      return { NOT: jsonEquals(path, asString(value)) };
    case "in":
      return { OR: asStringArray(value).map((v) => jsonEquals(path, v)) };
    case "not_in":
      return { NOT: { OR: asStringArray(value).map((v) => jsonEquals(path, v)) } };
    case "contains":
      return { attributes: { path: [path], string_contains: asString(value) } };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for attribute '${path}'`);
  }
}

function jsonHasTag(path: string, tag: string): Prisma.CustomerWhereInput {
  return { attributes: { path: [path], array_contains: tag } };
}

function jsonArrayWhere(
  path: string,
  op: SegmentOperator,
  value: SegmentValue,
): Prisma.CustomerWhereInput {
  switch (op) {
    case "eq":
    case "contains":
      return jsonHasTag(path, asString(value));
    case "neq":
      return { NOT: jsonHasTag(path, asString(value)) };
    case "in":
      return { OR: asStringArray(value).map((v) => jsonHasTag(path, v)) };
    case "not_in":
      return { NOT: { OR: asStringArray(value).map((v) => jsonHasTag(path, v)) } };
    default:
      throw new SegmentCompileError(`Operator '${op}' is not valid for array attribute '${path}'`);
  }
}

// ─── Leaf + tree compilation ─────────────────────────────────────────

function compileLeaf(leaf: SegmentLeaf): Prisma.CustomerWhereInput {
  // Defense in depth: re-enforce the whitelist even though @xeno/shared validated upstream.
  if (!FIELD_SET.has(leaf.field)) {
    throw new SegmentCompileError(`Unknown field: ${String(leaf.field)}`);
  }
  if (!OPERATOR_SET.has(leaf.operator)) {
    throw new SegmentCompileError(`Unknown operator: ${String(leaf.operator)}`);
  }

  const { field, operator, value } = leaf;
  switch (field) {
    // Scalar customer columns.
    case "customer.total_spend":
      return { totalSpend: decimalFilter(operator, value) };
    case "customer.order_count":
      return { orderCount: intFilter(operator, value) };
    case "customer.first_order_at":
      return { firstOrderAt: dateFilter(operator, value) };
    case "customer.last_order_at":
      return { lastOrderAt: dateFilter(operator, value) };

    // JSON attribute columns.
    case "customer.city":
      return jsonStringWhere("city", operator, value);
    case "customer.tier":
      return jsonStringWhere("tier", operator, value);
    case "customer.tags":
      return jsonArrayWhere("tags", operator, value);

    // Relation filters: customer HAS some order (and, for items, some item) matching.
    case "order.total_amount":
      return { orders: { some: { totalAmount: decimalFilter(operator, value) } } };
    case "order.status":
      return { orders: { some: { status: stringFilter(operator, value) } } };
    case "order_item.category":
      return {
        orders: { some: { items: { some: { category: stringFilter(operator, value) } } } },
      };

    default:
      // Unreachable for whitelisted fields; kept as a runtime guard.
      throw new SegmentCompileError(`Unknown field: ${String(field)}`);
  }
}

function compileNode(node: SegmentNode): Prisma.CustomerWhereInput {
  if ("op" in node) {
    const children = node.conditions.map(compileNode);
    switch (node.op) {
      case "AND":
        return { AND: children };
      case "OR":
        return { OR: children };
      case "NOT":
        // Negate the whole group: NOT(c1 AND c2 ...).
        return { NOT: children.length === 1 ? children[0] : { AND: children } };
      default:
        throw new SegmentCompileError(`Unknown group operator: ${String(node.op)}`);
    }
  }
  return compileLeaf(node);
}

/**
 * Compile a validated segment definition into a Prisma `where` for Customer. Pure and
 * deterministic apart from relative-time cutoffs (which read `now`). Throws
 * SegmentCompileError on any whitelist or operator/value violation.
 */
export function compileSegmentDefinition(
  definition: SegmentDefinition,
): Prisma.CustomerWhereInput {
  return compileNode(definition);
}
