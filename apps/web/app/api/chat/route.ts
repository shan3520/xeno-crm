import { type ModelMessage, stepCountIs, streamText } from "ai";

import { buildTools } from "@/lib/ai/tools";
import { hasGeminiKey } from "@/lib/ai/provider";
import { providerChain, withFallback } from "@/lib/ai/providers";
import { isRateLimited } from "@/lib/ai/errors";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { crm } from "@/lib/crm-client";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby ceiling — keep turns to <=2 tool calls.

/** Allow up to 2 tool-call rounds + a final text step before stopping. */
const MAX_STEPS = 3;
/**
 * SDK retries (exponential backoff) before a 429 is surfaced as a typed error. Kept modest:
 * against quota-exhausted free tiers each retry re-sends the full turn and eats more of the
 * token budget (and clock, toward STREAM_TIMEOUT_MS) without changing the outcome. After these,
 * withFallback tries the next provider, then the turn degrades to a retry banner.
 */
const MAX_MODEL_RETRIES = 2;
/**
 * Hard ceiling for the whole model turn, safely under Vercel's maxDuration (60s). Without it,
 * a stalled Gemini call (free-tier quota backoff) rides until Vercel hard-kills the function —
 * the stream just dies and the client spins on "Thinking…" forever with no error to render.
 * Aborting ourselves turns the stall into a typed error part the UI shows as a retry banner.
 */
const STREAM_TIMEOUT_MS = 50_000;

/** True for an AbortSignal.timeout()-style abort (DOMException TimeoutError / AbortError). */
function isTimeout(error: unknown): boolean {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true;
  }
  return /timed?.?out|aborted/i.test(error instanceof Error ? error.message : String(error));
}

interface IncomingMessage {
  role: "user" | "assistant" | "system";
  // Either a plain string, or AI SDK UIMessage parts.
  content?: unknown;
  parts?: Array<{ type: string; text?: string }>;
}

/** Flatten a UIMessage (or simple {role,content}) to plain text. */
function messageText(m: IncomingMessage): string {
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
}

export async function POST(req: Request): Promise<Response> {
  // Ordered fallback chain (default: "groq,gemini" — see providerChain()). An empty chain
  // means no provider listed in AI_PROVIDER_ORDER has its key set on the server.
  const chain = providerChain();
  if (chain.length === 0) {
    return Response.json(
      {
        error: "config",
        message: hasGeminiKey()
          ? "No configured AI provider in AI_PROVIDER_ORDER — check the provider API keys."
          : "GEMINI_API_KEY is not configured on the server.",
      },
      { status: 500 },
    );
  }
  // Health signal: the providers actually IN PLAY this request (ids only, never keys). A provider
  // whose key is missing is silently dropped from the chain — so if you expect e.g. "nvidia,groq,
  // gemini" but the log shows "groq,gemini", that env key isn't set. Pairs with the per-turn
  // "served by" log below to expose a bad-key cascade (key present but 401/403 → falls through).
  console.log(`[/api/chat] provider chain: ${chain.map((c) => c.id).join(",")}`);

  let body: { messages?: IncomingMessage[]; threadId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return Response.json({ error: "bad_request", message: "messages[] is required." }, { status: 400 });
  }

  // Ensure a thread, then persist the latest user turn. The AI never writes — the route does,
  // via the CRM. Persistence failures must not block the conversation, so they're swallowed.
  let threadId = body.threadId;
  if (!threadId) {
    try {
      threadId = (await crm.createThread()).id;
    } catch {
      threadId = undefined;
    }
  }
  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  if (threadId && lastUser) {
    // Fire-and-forget: persisting the user turn is best-effort and must NEVER gate the stream.
    // Awaiting it (through a CRM call) is what froze the whole turn when chat-threads hung — the
    // response couldn't start until this resolved. createThread above stays awaited (its id feeds
    // the x-thread-id header) but is now bounded by the crm-client timeout, so it can't hang either.
    void crm
      .appendMessages(threadId, [{ role: "USER", content: messageText(lastUser) }])
      .catch(() => undefined);
  }

  const modelMessages: ModelMessage[] = incoming
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: messageText(m) }));

  const result = streamText({
    // A single-entry chain is just that provider's model unwrapped; with more entries a
    // rate-limited/unavailable primary falls through to the next provider transparently.
    model: withFallback(chain, (served) => {
      // Always log who served — not just on fallback — so logs show the real provider per turn.
      const viaFallback = served.id !== chain[0]!.id;
      console.log(
        `[/api/chat] turn served by "${served.id}" (${served.tag})${viaFallback ? " [FALLBACK]" : ""}`,
      );
    }),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools: buildTools(),
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: MAX_MODEL_RETRIES,
    abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    // A transient model error (e.g. a 429 surviving retries) is surfaced into the stream as a
    // typed error part rather than crashing the request.
    onError: ({ error }) => {
      console.error("[/api/chat] stream error:", error);
    },
    onFinish: async ({ text }) => {
      if (threadId && text) {
        await crm
          .appendMessages(threadId, [{ role: "ASSISTANT", content: text }])
          .catch(() => undefined);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: threadId ? { "x-thread-id": threadId } : undefined,
    // Surface a friendly, client-parseable message instead of the SDK's masked default. A
    // top-level rate-limit (the orchestrator model, not a tool) becomes a visible retry state.
    onError: (error) =>
      isRateLimited(error)
        ? "rate_limited: The model is busy right now — please retry in a moment."
        : isTimeout(error)
          ? "rate_limited: The model took too long to respond (it is likely rate-limited) — please retry in a moment."
          : "The assistant hit a snag. Please try again.",
  });
}
