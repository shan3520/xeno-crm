import { z } from "zod";

/**
 * Cross-cutting enums. Each is exported as a Zod schema (`<Name>Schema`, a runtime
 * value usable for `.parse`/`.options`) plus its inferred TS type (`<Name>`).
 */

export const ChannelSchema = z.enum(["EMAIL", "SMS", "WHATSAPP", "RCS"]);
export type Channel = z.infer<typeof ChannelSchema>;

/** Projected status of a Communication (precedence over CommunicationEvents). */
export const CommStatusSchema = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "OPENED",
  "READ",
  "CLICKED",
  "FAILED",
]);
export type CommStatus = z.infer<typeof CommStatusSchema>;

/** Append-only event types emitted by the channel stub. CONVERTED has no status peer. */
export const CommEventTypeSchema = z.enum([
  "SENT",
  "DELIVERED",
  "OPENED",
  "READ",
  "CLICKED",
  "FAILED",
  "CONVERTED",
]);
export type CommEventType = z.infer<typeof CommEventTypeSchema>;

export const SegmentOriginSchema = z.enum(["AI", "MANUAL"]);
export type SegmentOrigin = z.infer<typeof SegmentOriginSchema>;

export const CampaignStatusSchema = z.enum([
  "DRAFT",
  "LAUNCHING",
  "SENDING",
  "COMPLETED",
  "FAILED",
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const AiTaskKindSchema = z.enum([
  "SEGMENT_RULE",
  "MESSAGE_DRAFT",
  "RESULTS_NARRATIVE",
]);
export type AiTaskKind = z.infer<typeof AiTaskKindSchema>;
