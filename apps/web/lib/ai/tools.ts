import { generateObject, generateText, tool } from "ai";
import {
  AI_TOOL_NAMES,
  DraftMessageInputSchema,
  DraftMessageOutputSchema,
  GenerateSegmentRuleInputSchema,
  GenerateSegmentRuleOutputSchema,
  NarrateResultsInputSchema,
  NarrateResultsOutputSchema,
} from "@xeno/shared";

import { crm } from "@/lib/crm-client";
import { toToolFailure, type ToolFailure } from "@/lib/ai/errors";
import { GEMINI_MODEL_ID } from "@/lib/ai/provider";
import { providerChain, withFallback } from "@/lib/ai/providers";
import { MESSAGE_TOKENS, SEGMENT_GEN_SYSTEM, SYSTEM_PROMPT } from "@/lib/ai/system-prompt";

const MAX_MODEL_RETRIES = 3; // SDK does exponential backoff between these (covers 429s).

/**
 * Resolve the provider fallback chain for ONE tool call and track which provider actually
 * served it, so the AiTaskLog row records the real provider+model (e.g. "gemini-2.5-flash"
 * or "groq:llama-3.3-70b-versatile"). With the default single-provider chain this is the
 * bare gemini model and the tag is GEMINI_MODEL_ID — identical to the pre-fallback rows.
 */
function resolveModel() {
  const chain = providerChain();
  let tag = chain[0]?.tag ?? GEMINI_MODEL_ID;
  const model = withFallback(chain, (served) => {
    tag = served.tag;
  });
  return { model, servedTag: () => tag };
}

/** Best-effort AI audit write — a logging failure must never break a tool result. */
async function logTask(
  kind: "SEGMENT_RULE" | "MESSAGE_DRAFT" | "RESULTS_NARRATIVE",
  model: string,
  latencyMs: number,
  usage: { inputTokens?: number; outputTokens?: number },
  input: unknown,
  output: unknown,
): Promise<void> {
  try {
    await crm.writeAiTaskLog({
      kind,
      model,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      input,
      output,
    });
  } catch {
    // swallow — audit logging is best-effort
  }
}

/** Pull the first JSON object out of a model text response (tolerates ```json fences). */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("model did not return a JSON object");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * generate_segment_rule — turn intent into a DSL definition, then attach a LIVE audience via
 * CRM /segments/preview. We generate via text + strict zod validation rather than the
 * provider's native schema mode because the segment DSL is recursive; the @xeno/shared schema
 * (with its field/operator whitelist) is the gate — a non-whitelisted field fails validation
 * here and never reaches the preview or the DB.
 */
const generateSegmentRule = tool({
  description:
    "Propose an auditable, editable audience SEGMENT from the marketer's intent and attach its live size. Use for any 'who should we target' request.",
  inputSchema: GenerateSegmentRuleInputSchema,
  async execute({ intent }) {
    const started = Date.now();
    try {
      const { model, servedTag } = resolveModel();
      const { text, usage } = await generateText({
        model,
        maxRetries: MAX_MODEL_RETRIES,
        temperature: 0, // deterministic, on-spec JSON
        system: SEGMENT_GEN_SYSTEM,
        prompt: `Marketer intent: ${intent}\n\nRespond with the JSON object only.`,
      });

      const parsed = GenerateSegmentRuleOutputSchema.safeParse(parseJsonObject(text));
      if (!parsed.success) {
        // e.g. a non-whitelisted field/operator — reject, never hit preview or the DB.
        await logTask("SEGMENT_RULE", servedTag(), Date.now() - started, usage, { intent }, {
          validationError: parsed.error.message,
        });
        return {
          ok: false,
          error: "validation_failed",
          message: `The proposed rule failed validation (likely a non-whitelisted field): ${parsed.error.message}`,
        } satisfies ToolFailure;
      }

      const preview = await crm.segmentPreview(parsed.data.definition);
      await logTask(
        "SEGMENT_RULE",
        servedTag(),
        Date.now() - started,
        usage,
        { intent },
        { ...parsed.data, count: preview.count },
      );
      return {
        ok: true as const,
        name: parsed.data.name,
        description: parsed.data.description,
        definition: parsed.data.definition,
        count: preview.count,
        sample: preview.sample,
      };
    } catch (err) {
      return toToolFailure(err);
    }
  },
});

/**
 * draft_message — channel-appropriate copy with the documented {{tokens}}. Output is validated
 * against the @xeno/shared schema before returning.
 */
const draftMessage = tool({
  description:
    "Draft channel-appropriate campaign copy (EMAIL/SMS/WHATSAPP/RCS) for a given audience, using {{tokens}} like {{first_name}}.",
  inputSchema: DraftMessageInputSchema,
  async execute({ brief, channel, segmentSummary }) {
    const started = Date.now();
    try {
      const { model, servedTag } = resolveModel();
      const { object, usage } = await generateObject({
        model,
        maxRetries: MAX_MODEL_RETRIES,
        schema: DraftMessageOutputSchema,
        system: `${SYSTEM_PROMPT}\n\nWrite for channel ${channel}. Personalize ONLY with these tokens: ${MESSAGE_TOKENS.map((t) => `{{${t}}}`).join(", ")}. Set "channel" to ${channel}.`,
        prompt: `Audience: ${segmentSummary}\nBrief: ${brief}`,
      });

      const parsed = DraftMessageOutputSchema.safeParse(object);
      if (!parsed.success) {
        await logTask("MESSAGE_DRAFT", servedTag(), Date.now() - started, usage, { brief, channel }, {
          validationError: parsed.error.message,
        });
        return {
          ok: false,
          error: "validation_failed",
          message: `The drafted message failed validation: ${parsed.error.message}`,
        } satisfies ToolFailure;
      }

      await logTask(
        "MESSAGE_DRAFT",
        servedTag(),
        Date.now() - started,
        usage,
        { brief, channel, segmentSummary },
        parsed.data,
      );
      return {
        ok: true as const,
        channel: parsed.data.channel,
        body: parsed.data.body,
        rationale: parsed.data.rationale,
      };
    } catch (err) {
      return toToolFailure(err);
    }
  },
});

/**
 * narrate_results — read the REAL campaign stats from the CRM and explain them. The narrative
 * is grounded in fetched numbers, never invented; validated before returning.
 */
const narrateResults = tool({
  description:
    "Explain how a campaign performed in plain language, grounded in its real funnel stats. Requires a campaignId.",
  inputSchema: NarrateResultsInputSchema,
  async execute({ campaignId }) {
    const started = Date.now();
    try {
      const stats = await crm.campaignStats(campaignId);
      const { model, servedTag } = resolveModel();
      const { object, usage } = await generateObject({
        model,
        maxRetries: MAX_MODEL_RETRIES,
        schema: NarrateResultsOutputSchema,
        system: `${SYSTEM_PROMPT}\n\nGround every claim in the provided numbers — do not invent figures. Produce headline, whatHappened, why, and a concrete nextAction.`,
        prompt: `Campaign stats JSON:\n${JSON.stringify(stats)}`,
      });

      const parsed = NarrateResultsOutputSchema.safeParse(object);
      if (!parsed.success) {
        await logTask("RESULTS_NARRATIVE", servedTag(), Date.now() - started, usage, { campaignId }, {
          validationError: parsed.error.message,
        });
        return {
          ok: false,
          error: "validation_failed",
          message: `The results narrative failed validation: ${parsed.error.message}`,
        } satisfies ToolFailure;
      }

      await logTask(
        "RESULTS_NARRATIVE",
        servedTag(),
        Date.now() - started,
        usage,
        { campaignId },
        parsed.data,
      );
      return {
        ok: true as const,
        ...parsed.data,
        stats: {
          funnel: stats.funnel,
          rates: stats.rates,
          attributedRevenue: stats.attributedRevenue,
        },
      };
    } catch (err) {
      return toToolFailure(err);
    }
  },
});

/** The tool set exposed to the model, keyed by the frozen @xeno/shared tool names. */
export function buildTools() {
  return {
    [AI_TOOL_NAMES.generateSegmentRule]: generateSegmentRule,
    [AI_TOOL_NAMES.draftMessage]: draftMessage,
    [AI_TOOL_NAMES.narrateResults]: narrateResults,
  };
}
