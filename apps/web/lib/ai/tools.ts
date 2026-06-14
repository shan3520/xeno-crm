import { generateText, tool } from "ai";
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
import { MESSAGE_TOKENS, SEGMENT_GEN_SYSTEM } from "@/lib/ai/system-prompt";

/**
 * SDK retries (exponential backoff) per tool sub-call. Kept LOW on purpose: every retry
 * re-sends the full prompt, and when the free-tier providers are quota-exhausted (Groq's
 * 6k TPM, Gemini's daily quota) retrying just burns more of an already-spent token budget
 * and pushes the turn toward the 50s abort. One retry covers a momentary blip; a real
 * exhaustion then falls through withFallback to the next provider, and finally degrades to a
 * typed "rate-limited, retry" surface — instead of spinning. The orchestrator (route.ts)
 * adds its own retry layer on top of this.
 */
const MAX_MODEL_RETRIES = 1;

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
  if (start === -1) {
    throw new Error("model did not return a JSON object");
  }
  
  let balance = 0;
  let end = -1;
  // We must handle strings so we don't count braces inside strings.
  let inString = false;
  let escape = false;
  
  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        balance++;
      } else if (char === '}') {
        balance--;
      }
      
      if (balance === 0) {
        end = i;
        break;
      }
    }
  }
  
  if (end === -1 || end < start) {
    throw new Error("model did not return a valid balanced JSON object");
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
        sample: (preview.sample as any[]).slice(0, 6).map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: null,
          attributes: null,
        })),
      };
    } catch (err) {
      return toToolFailure(err);
    }
  },
});

/**
 * draft_message — channel-appropriate copy with the documented {{tokens}}.
 *
 * Generated via generateText + manual JSON parse (NOT generateObject), matching
 * generate_segment_rule. The Vercel AI SDK's generateObject sends a `response_format`
 * (json_schema, or json_object for mode:"json") that Groq's llama-3.3-70b rejects with a 400
 * — a hard error, not a fallback trigger — which is why the segment path was migrated off it.
 * draft_message and narrate_results now share that Groq-safe pattern: a tight, prompt-only
 * JSON instruction (no heavy SYSTEM_PROMPT — that lives on the orchestrator turn, re-sending
 * it here just doubles the token cost against the TPM ceiling), parse, then strict zod gate.
 */
const draftMessage = tool({
  description:
    "Draft channel-appropriate campaign copy (EMAIL/SMS/WHATSAPP/RCS) for a given audience, using {{tokens}} like {{first_name}}.",
  inputSchema: DraftMessageInputSchema,
  async execute({ brief, channel, segmentSummary }) {
    const started = Date.now();
    try {
      const { model, servedTag } = resolveModel();
      const { text, usage } = await generateText({
        model,
        maxRetries: MAX_MODEL_RETRIES,
        temperature: 0.6,
        maxOutputTokens: 500,
        system: `You draft ${channel} campaign copy for Looms, a D2C apparel brand.\n\nOutput ONLY a single JSON object — no prose, no markdown fences — with EXACTLY these keys:\n{"channel": "${channel}", "body": string, "rationale": string}\n\nPersonalize ONLY with these tokens, in double braces: ${MESSAGE_TOKENS.map((t) => `{{${t}}}`).join(", ")}.\nWrite complete, ready-to-send copy. NEVER leave bracketed placeholders such as [insert link], [Link], [code], or [discount] — write any offer code out in full (e.g. WELCOME20) and omit URLs entirely rather than leaving a placeholder.\n${channel === "SMS" ? "SMS: keep it short (aim under 160 characters)." : "EMAIL: you may include a subject-like opening line."}`,
        prompt: `Audience: ${segmentSummary}\nBrief: ${brief}\n\nRespond with the JSON object only.`,
      });

      const parsed = DraftMessageOutputSchema.safeParse(parseJsonObject(text));
      if (!parsed.success) {
        await logTask("MESSAGE_DRAFT", servedTag(), Date.now() - started, usage, { brief, channel, segmentSummary }, {
          validationError: parsed.error.message,
        });
        return {
          ok: false,
          error: "failed",
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
      // generateText + parse, not generateObject — see draft_message for why (Groq json mode).
      const { text, usage } = await generateText({
        model,
        maxRetries: MAX_MODEL_RETRIES,
        temperature: 0,
        maxOutputTokens: 500,
        system: `You explain campaign performance for Looms, a D2C apparel brand.\n\nOutput ONLY a single JSON object — no prose, no markdown fences — with EXACTLY these keys:\n{"headline": string, "whatHappened": string, "why": string, "nextAction": string}\n\nGround every claim in the provided numbers — do not invent figures.`,
        prompt: `Campaign stats JSON:\n${JSON.stringify(stats)}\n\nRespond with the JSON object only.`,
      });

      const parsed = NarrateResultsOutputSchema.safeParse(parseJsonObject(text));
      if (!parsed.success) {
        await logTask("RESULTS_NARRATIVE", servedTag(), Date.now() - started, usage, { campaignId }, {
          validationError: parsed.error.message,
        });
        return {
          ok: false,
          error: "failed",
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
