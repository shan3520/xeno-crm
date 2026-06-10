import type { Channel, SegmentDefinition } from "@xeno/shared";

/**
 * CLIENT-SAFE mirrors of what the /api/chat tools return as their tool-result `output`.
 * They are typed here (not imported from lib/ai/tools.ts) so console components can narrow a
 * tool part's `output` without pulling the server-only tools module (which imports the AI SDK
 * server fns + server env) into the browser bundle. The shapes match tools.ts exactly.
 */

/** A previewed audience member (subset of the CRM CustomerResponse we render/personalize on). */
export interface SampleCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  attributes: unknown;
}

export interface SegmentRuleSuccess {
  ok: true;
  name: string;
  description: string;
  definition: SegmentDefinition;
  count: number;
  sample: SampleCustomer[];
}

export interface DraftMessageSuccess {
  ok: true;
  channel: Channel;
  body: string;
  rationale?: string;
}

export interface NarrateResultsSuccess {
  ok: true;
  headline: string;
  whatHappened: string;
  why: string;
  nextAction: string;
  stats: {
    funnel: Record<string, number>;
    rates: Record<string, number>;
    attributedRevenue: string;
  };
}

/** Mirrors ToolFailure in lib/ai/errors.ts — the typed degraded result a tool returns. */
export interface ToolFailure {
  ok: false;
  error: "rate_limited" | "validation_failed" | "failed";
  message: string;
}

export type SegmentRuleResult = SegmentRuleSuccess | ToolFailure;
export type DraftMessageResult = DraftMessageSuccess | ToolFailure;
export type NarrateResultsResult = NarrateResultsSuccess | ToolFailure;

/** Narrow an unknown tool output to a discriminated {ok} result. */
export function isOk<T extends { ok: true }>(
  output: unknown,
): output is T {
  return Boolean(output) && (output as { ok?: unknown }).ok === true;
}

export function asFailure(output: unknown): ToolFailure | null {
  if (output && (output as { ok?: unknown }).ok === false) {
    return output as ToolFailure;
  }
  return null;
}
