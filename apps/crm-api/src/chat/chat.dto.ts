import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Persistence DTOs for the conversation + AI audit log. These are storage contracts (not the
 * frozen @xeno/shared AI tool I/O), so they live here in crm-api. The web /api/chat route is
 * the only caller; the AI itself never writes — it returns structured objects the route persists.
 */

/** Mirrors the Prisma ChatRole enum. */
export const ChatRoleSchema = z.enum(["USER", "ASSISTANT", "TOOL"]);

/** Mirrors the Prisma AiTaskKind enum. */
export const AiTaskKindSchema = z.enum([
  "SEGMENT_RULE",
  "MESSAGE_DRAFT",
  "RESULTS_NARRATIVE",
]);

/** Message content is free-form JSON (a text string, or a structured tool payload). */
const ContentSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const CreateThreadBodySchema = z.object({
  title: z.string().min(1).optional(),
});
export class CreateThreadDto extends createZodDto(CreateThreadBodySchema) {}

export const AppendMessagesBodySchema = z.object({
  messages: z
    .array(z.object({ role: ChatRoleSchema, content: ContentSchema }))
    .min(1),
});
export class AppendMessagesDto extends createZodDto(AppendMessagesBodySchema) {}

export const CreateAiTaskLogBodySchema = z.object({
  kind: AiTaskKindSchema,
  model: z.string().min(1),
  latencyMs: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
export class CreateAiTaskLogDto extends createZodDto(CreateAiTaskLogBodySchema) {}
