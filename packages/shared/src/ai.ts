import { z } from "zod";

import { ChannelSchema } from "./enums";
import { SegmentDefinitionSchema } from "./segment";

/**
 * AI tool I/O contracts. crm-api, web, and the Next.js /api/chat route all import these
 * verbatim so the tool definitions, server validation, and client types never drift.
 * Tool names match the function-call identifiers exposed to the model.
 */

export const AI_TOOL_NAMES = {
  generateSegmentRule: "generate_segment_rule",
  draftMessage: "draft_message",
  narrateResults: "narrate_results",
} as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[keyof typeof AI_TOOL_NAMES];

// ---- generate_segment_rule ----

export const GenerateSegmentRuleInputSchema = z.object({
  intent: z.string().min(1),
});
export type GenerateSegmentRuleInput = z.infer<
  typeof GenerateSegmentRuleInputSchema
>;

export const GenerateSegmentRuleOutputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  definition: SegmentDefinitionSchema,
});
export type GenerateSegmentRuleOutput = z.infer<
  typeof GenerateSegmentRuleOutputSchema
>;

// ---- draft_message ----

export const DraftMessageInputSchema = z.object({
  brief: z.string().min(1),
  channel: ChannelSchema,
  segmentSummary: z.string(),
});
export type DraftMessageInput = z.infer<typeof DraftMessageInputSchema>;

export const DraftMessageOutputSchema = z.object({
  channel: ChannelSchema,
  // May contain {{token}} placeholders, resolved per-recipient at send time.
  body: z.string().min(1),
  rationale: z.string().optional(),
});
export type DraftMessageOutput = z.infer<typeof DraftMessageOutputSchema>;

// ---- narrate_results ----

export const NarrateResultsInputSchema = z.object({
  campaignId: z.string().min(1),
});
export type NarrateResultsInput = z.infer<typeof NarrateResultsInputSchema>;

export const NarrateResultsOutputSchema = z.object({
  headline: z.string().min(1),
  whatHappened: z.string().min(1),
  why: z.string().min(1),
  nextAction: z.string().min(1),
});
export type NarrateResultsOutput = z.infer<typeof NarrateResultsOutputSchema>;
